// Edge Function for Voice Agent - Audio Transcription & LLM Processing
// Handles audio upload, Deepgram transcription, and sends to LLM service

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

    // Step 2: Send transcript to LLM service
    console.log(`🤖 Calling LLM service with user_id: ${userId}`);

    const llmServiceUrl = 'https://final-personal-site.onrender.com/process';
    const llmResponse = await fetch(llmServiceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId,
        query: transcript,
      }),
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      console.error('LLM service error:', errorText);
      throw new Error(`LLM service failed: ${llmResponse.status} - ${errorText}`);
    }

    const llmResult = await llmResponse.json();
    console.log(`✅ LLM Response: ${llmResult.response}`);

    // Return result in the expected format
    return new Response(
      JSON.stringify({
        success: llmResult.success,
        message: llmResult.response,
        transcript: transcript,
      }),
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

