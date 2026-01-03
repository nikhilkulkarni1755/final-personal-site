# Voice Agent Setup Guide

## Prerequisites

1. Supabase account with your project set up
2. Deepgram account (free tier available)

## Step 1: Get Deepgram API Key

1. Go to https://console.deepgram.com/
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key
5. Copy the API key

## Step 2: Configure Supabase Edge Function Secrets

You need to set the Deepgram API key as a secret in Supabase:

### Option A: Via Supabase Dashboard
1. Go to your Supabase project dashboard
2. Navigate to: Settings → Edge Functions
3. Add secret:
   - Key: `DEEPGRAM_API_KEY`
   - Value: Your Deepgram API key

### Option B: Via Supabase CLI
```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref couqjixnoxrefzlyqucq

# Set the secret
supabase secrets set DEEPGRAM_API_KEY=your_deepgram_key_here
```

## Step 3: Deploy the Edge Function

```bash
# Deploy the voice-agent function
supabase functions deploy voice-agent

# Verify deployment
supabase functions list
```

## Step 4: Test the Function

1. Go to http://localhost:5173/spearfishing/voice-agent
2. Click the microphone button
3. Allow microphone access
4. Say: "Buy 2 units of MindEase"
5. Click the mic again to stop recording
6. Watch the transcription and purchase happen!

## Supported Voice Commands

- **Buy drugs**: "Buy 2 units of MindEase"
- **Check balance**: "What is my balance?"
- **List drugs**: "Show available drugs"
- **Get info**: "Tell me about PainAway"

## Troubleshooting

### "DEEPGRAM_API_KEY not configured"
- Make sure you set the secret in Supabase
- Redeploy the function after setting secrets
- Verify the secret is set: `supabase secrets list`

### Audio not recording
- Check browser permissions
- Must use HTTPS or localhost
- Try refreshing the page

### Transcription errors
- Check Deepgram API key is valid
- Check you have credits available in Deepgram console
- View edge function logs: `supabase functions logs voice-agent`

## API Costs

Deepgram API:
- **FREE tier**: $200 credit (approx. 45,000 minutes of audio)
- **Pay-as-you-go**: $0.0043/minute for Nova-2 model
- **Real-time transcription**: Fast and accurate
- **Supports multiple audio formats**: WebM, MP3, WAV, etc.

Excellent for production applications!

## Model Options

Deepgram uses the Nova-2 model by default in `supabase/functions/voice-agent/index.ts`:

```typescript
const deepgramUrl = 'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true';
// Other options: model=whisper, model=base, model=enhanced
```

## Next Steps

After deployment:
1. Test all voice commands
2. Monitor function logs: `supabase functions logs voice-agent`
3. Check usage at https://huggingface.co/settings/billing
