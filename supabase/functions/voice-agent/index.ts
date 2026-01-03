// Edge Function for Voice Agent - Audio Transcription & Command Processing
// Handles audio upload, Whisper transcription, and purchase execution

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WhisperResponse {
  text: string;
}

interface CommandResult {
  success: boolean;
  message: string;
  transcript: string;
  command?: {
    action: string;
    drug?: string;
    quantity?: number;
  };
  new_balance?: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get Deepgram API key from environment
    const deepgramApiKey = Deno.env.get('DEEPGRAM_API_KEY');
    if (!deepgramApiKey) {
      throw new Error('DEEPGRAM_API_KEY not configured');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse multipart form data to get audio file
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;
    const userId = formData.get('user_id') as string;

    if (!audioFile) {
      return new Response(
        JSON.stringify({ success: false, message: 'No audio file provided' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`🎤 Received audio file: ${audioFile.name}, size: ${audioFile.size} bytes`);

    // Step 1: Transcribe audio using Deepgram API
    // Convert audio file to ArrayBuffer
    const audioBuffer = await audioFile.arrayBuffer();

    // Deepgram API endpoint
    const deepgramUrl = 'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true';

    console.log(`🎙️ Calling Deepgram API...`);

    const deepgramResponse = await fetch(deepgramUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${deepgramApiKey}`,
        'Content-Type': 'audio/webm',
      },
      body: audioBuffer,
    });

    if (!deepgramResponse.ok) {
      const error = await deepgramResponse.text();
      console.error('Deepgram API error:', error);
      throw new Error(`Deepgram API failed: ${deepgramResponse.status} - ${error}`);
    }

    const deepgramData = await deepgramResponse.json();
    const transcript = deepgramData.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || '';

    if (!transcript) {
      throw new Error('No transcript returned from Deepgram');
    }

    console.log(`📝 Transcript: "${transcript}"`);

    // Step 2: Parse the command
    const result = await parseAndExecuteCommand(transcript, userId, supabase);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in voice-agent function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        transcript: '',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

/**
 * Parse voice command and execute the appropriate action
 */
async function parseAndExecuteCommand(
  transcript: string,
  userId: string,
  supabase: any
): Promise<CommandResult> {
  const lowerTranscript = transcript.toLowerCase();

  // Command pattern: "buy X units of [drug name]" or "purchase X [drug name]"
  const buyPattern = /(?:buy|purchase)\s+(\d+)\s+(?:units?\s+of\s+)?(\w+)/i;
  const match = lowerTranscript.match(buyPattern);

  if (match) {
    const quantity = parseInt(match[1]);
    const drugName = match[2].charAt(0).toUpperCase() + match[2].slice(1); // Capitalize first letter

    console.log(`🛒 Purchase command: ${quantity} units of ${drugName}`);

    // Execute purchase
    try {
      // Get drug info
      const { data: drug, error: drugError } = await supabase
        .from('drugs')
        .select('*')
        .ilike('name', drugName)
        .single();

      if (drugError || !drug) {
        return {
          success: false,
          message: `Drug "${drugName}" not found. Available drugs: PainAway, MindEase, CogniFocus, ImmuneBoost`,
          transcript,
          command: { action: 'buy', drug: drugName, quantity },
        };
      }

      // Get user balance
      const { data: user } = await supabase
        .from('marketplace_users')
        .select('token_balance')
        .eq('user_id', userId)
        .single();

      if (!user) {
        return {
          success: false,
          message: 'User not found',
          transcript,
        };
      }

      // Validate purchase
      const totalCost = drug.price * quantity;
      if (user.token_balance < totalCost) {
        return {
          success: false,
          message: `Insufficient tokens. Need ${totalCost}, have ${user.token_balance}`,
          transcript,
          command: { action: 'buy', drug: drugName, quantity },
        };
      }

      if (drug.stock < quantity) {
        return {
          success: false,
          message: `Insufficient stock. Only ${drug.stock} units available`,
          transcript,
          command: { action: 'buy', drug: drugName, quantity },
        };
      }

      // Execute purchase transaction
      const newBalance = user.token_balance - totalCost;

      // Update balance
      await supabase
        .from('marketplace_users')
        .update({ token_balance: newBalance })
        .eq('user_id', userId);

      // Update stock
      await supabase
        .from('drugs')
        .update({ stock: drug.stock - quantity })
        .eq('id', drug.id);

      // Record purchase
      await supabase
        .from('purchases')
        .insert({
          user_id: userId,
          drug_id: drug.id,
          quantity,
          total_cost: totalCost,
        });

      return {
        success: true,
        message: `Successfully purchased ${quantity} unit(s) of ${drug.name} for ${totalCost} tokens. New balance: ${newBalance} tokens.`,
        transcript,
        command: { action: 'buy', drug: drugName, quantity },
        new_balance: newBalance,
      };

    } catch (error) {
      console.error('Purchase error:', error);
      return {
        success: false,
        message: 'Failed to process purchase',
        transcript,
      };
    }
  }

  // Check balance command
  if (lowerTranscript.includes('balance') || lowerTranscript.includes('tokens')) {
    const { data: user } = await supabase
      .from('marketplace_users')
      .select('token_balance')
      .eq('user_id', userId)
      .single();

    if (user) {
      return {
        success: true,
        message: `Your current balance is ${user.token_balance} tokens.`,
        transcript,
        command: { action: 'balance' },
        new_balance: user.token_balance,
      };
    }
  }

  // Show drugs command
  if (lowerTranscript.includes('show') || lowerTranscript.includes('list') || lowerTranscript.includes('available')) {
    const { data: drugs } = await supabase
      .from('drugs')
      .select('name, price, stock')
      .order('price');

    if (drugs && drugs.length > 0) {
      const drugList = drugs.map((d: any) => `${d.name} (${d.price} tokens, ${d.stock} in stock)`).join(', ');
      return {
        success: true,
        message: `Available drugs: ${drugList}`,
        transcript,
        command: { action: 'list' },
      };
    }
  }

  // Unknown command
  return {
    success: false,
    message: `I didn't understand that command. Try: "Buy 2 units of MindEase" or "What is my balance?"`,
    transcript,
  };
}
