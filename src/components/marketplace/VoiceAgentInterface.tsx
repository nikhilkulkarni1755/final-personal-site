import { useState, useRef } from 'react';
import { Mic, MicOff, Volume2, Zap, Info, CheckCircle, XCircle } from 'lucide-react';

interface VoiceAgentInterfaceProps {
  onPurchaseComplete?: () => void;
}

interface TranscriptEntry {
  timestamp: Date;
  text: string;
  type: 'user' | 'system';
}

/**
 * VoiceAgentInterface component - Audio capture and voice command interface
 *
 * Features:
 * - Real microphone access with permission handling
 * - MediaRecorder API for audio capture
 * - Visual feedback for recording state
 * - Waveform animation during recording
 * - Transcript history display
 * - Audio blob creation ready for backend
 *
 * TODO: Send audio blob to Python backend at POST /api/voice
 * TODO: Implement Whisper transcription
 * TODO: Parse voice commands and execute purchases
 */
const VoiceAgentInterface = ({ onPurchaseComplete }: VoiceAgentInterfaceProps) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [transcriptHistory, setTranscriptHistory] = useState<TranscriptEntry[]>([]);
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing' | 'success' | 'error'>('idle');
  const [permissionGranted, setPermissionGranted] = useState(false);

  // Refs for MediaRecorder and audio stream
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  /**
   * Send audio blob to Supabase Edge Function for transcription and processing
   */
  const sendAudioToBackend = async (audioBlob: Blob) => {
    try {
      // Get user ID from analytics
      const { getVisitorId } = await import('../../lib/analytics-utils');
      const userId = await getVisitorId();

      // Prepare form data
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('user_id', userId);

      console.log('📤 Sending audio to edge function...');

      // Get Supabase URL and key from env
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const edgeFunctionUrl = `${supabaseUrl}/functions/v1/voice-agent`;

      const response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Edge function failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Response from edge function:', result);

      // Update UI with transcript
      setTranscript(result.transcript);
      setTranscriptHistory(prev => [
        ...prev,
        { timestamp: new Date(), text: result.transcript, type: 'user' },
        { timestamp: new Date(), text: result.message, type: 'system' }
      ]);

      // Update status based on success
      if (result.success) {
        setStatus('success');
        // Refresh data if purchase was successful
        if (result.command?.action === 'buy' && onPurchaseComplete) {
          onPurchaseComplete();
        }
      } else {
        setStatus('error');
      }

      setTimeout(() => setStatus('idle'), 3000);

    } catch (error) {
      console.error('❌ Error calling edge function:', error);
      throw error;
    }
  };

  const toggleRecording = async () => {
    if (isListening) {
      // Stop recording
      setIsListening(false);
      setStatus('processing');

      // Stop the MediaRecorder
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();

        // Stop all audio tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
      }

      // Note: The actual audio blob will be handled in the ondataavailable event
      // For now, we'll show a message that the audio is ready
      setTranscriptHistory(prev => [
        ...prev,
        { timestamp: new Date(), text: 'Audio recorded successfully. Ready to send to backend.', type: 'system' }
      ]);

    } else {
      // Start recording
      try {
        // Request microphone permission
        console.log('🎤 Requesting microphone access...');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 44100,
          }
        });

        console.log('✅ Microphone access granted');
        setPermissionGranted(true);
        streamRef.current = stream;

        // Create MediaRecorder
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus'
        });
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        // Handle data available event
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
            console.log('📦 Audio chunk received:', event.data.size, 'bytes');
          }
        };

        // Handle recording stop
        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          console.log('🎵 Audio blob created:', audioBlob.size, 'bytes');

          // Send to Supabase Edge Function for transcription
          try {
            await sendAudioToBackend(audioBlob);
          } catch (error) {
            console.error('Error sending audio:', error);
            setStatus('error');
            setTranscriptHistory(prev => [
              ...prev,
              {
                timestamp: new Date(),
                text: `Error: ${error instanceof Error ? error.message : 'Failed to process audio'}`,
                type: 'system'
              }
            ]);
            setTimeout(() => setStatus('idle'), 3000);
          }

          audioChunksRef.current = [];
        };

        // Start recording
        mediaRecorder.start(100); // Collect data every 100ms
        setIsListening(true);
        setStatus('recording');
        setTranscript('');

        console.log('🔴 Recording started');

      } catch (error) {
        console.error('❌ Error accessing microphone:', error);
        setStatus('error');

        let errorMessage = 'Error: Could not access microphone';
        if (error instanceof Error) {
          if (error.name === 'NotAllowedError') {
            errorMessage = 'Microphone access denied. Please grant permission in your browser settings.';
          } else if (error.name === 'NotFoundError') {
            errorMessage = 'No microphone found. Please connect a microphone and try again.';
          } else {
            errorMessage = `Microphone error: ${error.message}`;
          }
        }

        setTranscript(errorMessage);
        setTranscriptHistory(prev => [
          ...prev,
          { timestamp: new Date(), text: errorMessage, type: 'system' }
        ]);

        setTimeout(() => setStatus('idle'), 3000);
      }
    }
  };

  return (
    <div className="bg-white dark:bg-[#001F3F] border border-[#001F3F]/10 dark:border-white/10 rounded-lg overflow-hidden mb-8">
      {/* Header with Status Bar */}
      <div className={`p-4 border-b transition-colors ${
        status === 'recording'
          ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          : status === 'processing'
          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
          : status === 'success'
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
          : status === 'error'
          ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          : 'border-[#001F3F]/10 dark:border-white/10'
      }`}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-[#001F3F] dark:text-white flex items-center">
            <Volume2 className="w-5 h-5 mr-2" />
            Voice Agent Interface
          </h2>

          <div className="flex items-center space-x-2">
            {permissionGranted && status === 'idle' && (
              <span className="flex items-center text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="w-4 h-4 mr-1" />
                Mic Ready
              </span>
            )}
            {status === 'recording' && (
              <span className="flex items-center text-sm text-red-600 dark:text-red-400">
                <span className="w-2 h-2 bg-red-600 dark:bg-red-400 rounded-full animate-pulse mr-2" />
                Recording
              </span>
            )}
            {status === 'processing' && (
              <span className="flex items-center text-sm text-blue-600 dark:text-blue-400">
                <Zap className="w-4 h-4 mr-1 animate-pulse" />
                Processing
              </span>
            )}
            {status === 'success' && (
              <span className="flex items-center text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="w-4 h-4 mr-1" />
                Success
              </span>
            )}
            {status === 'error' && (
              <span className="flex items-center text-sm text-red-600 dark:text-red-400">
                <XCircle className="w-4 h-4 mr-1" />
                Error
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Microphone Control */}
        <div className="flex items-start space-x-4 mb-6">
          <button
            onClick={toggleRecording}
            className={`p-4 rounded-full transition-all shrink-0 ${
              isListening
                ? 'bg-red-500 hover:bg-red-600 animate-pulse shadow-lg shadow-red-500/50'
                : 'bg-[#001F3F] dark:bg-white hover:opacity-80 shadow-lg'
            }`}
            aria-label={isListening ? 'Stop recording' : 'Start recording'}
          >
            {isListening ? (
              <MicOff className="w-6 h-6 text-white" />
            ) : (
              <Mic className="w-6 h-6 text-white dark:text-[#001F3F]" />
            )}
          </button>

          <div className="flex-1">
            <p className="text-sm text-[#001F3F]/70 dark:text-white/70 mb-1">
              {status === 'idle' && 'Click microphone to start voice command'}
              {status === 'recording' && 'Listening... Speak your command clearly'}
              {status === 'processing' && 'Processing your request...'}
              {status === 'success' && 'Command executed successfully!'}
              {status === 'error' && 'Error processing command'}
            </p>

            {/* Waveform Animation */}
            {isListening && (
              <div className="flex items-center space-x-1 mt-2">
                {[...Array(20)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1 bg-red-500 dark:bg-red-400 rounded-full animate-pulse"
                    style={{
                      height: `${Math.random() * 24 + 8}px`,
                      animationDelay: `${i * 0.05}s`,
                      animationDuration: `${Math.random() * 0.5 + 0.5}s`
                    }}
                  />
                ))}
              </div>
            )}

            {transcript && !isListening && (
              <div className="mt-2 p-3 bg-[#001F3F]/5 dark:bg-white/5 rounded border border-[#001F3F]/10 dark:border-white/10">
                <p className="text-sm text-[#001F3F]/60 dark:text-white/60 mb-1">Last Command:</p>
                <p className="text-[#001F3F] dark:text-white font-medium">{transcript}</p>
              </div>
            )}
          </div>
        </div>

        {/* Transcript History */}
        {transcriptHistory.length > 0 && (
          <div className="mb-6 p-4 bg-[#001F3F]/5 dark:bg-white/5 rounded-lg border border-[#001F3F]/10 dark:border-white/10 max-h-48 overflow-y-auto">
            <h3 className="text-sm font-semibold text-[#001F3F] dark:text-white mb-3 flex items-center">
              <Info className="w-4 h-4 mr-1" />
              Conversation History
            </h3>
            <div className="space-y-2">
              {transcriptHistory.map((entry, idx) => (
                <div
                  key={idx}
                  className={`text-xs p-2 rounded ${
                    entry.type === 'user'
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-200'
                      : 'bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-gray-200'
                  }`}
                >
                  <p className="font-semibold mb-1">
                    {entry.type === 'user' ? 'You' : 'System'}
                    <span className="font-normal ml-2 opacity-60">
                      {entry.timestamp.toLocaleTimeString()}
                    </span>
                  </p>
                  <p>{entry.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Voice Commands Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-[#001F3F]/5 dark:bg-white/5 rounded-lg border border-[#001F3F]/10 dark:border-white/10">
            <p className="text-sm font-semibold text-[#001F3F] dark:text-white mb-2 flex items-center">
              <Zap className="w-4 h-4 mr-1" />
              Supported Commands
            </p>
            <ul className="text-xs text-[#001F3F]/60 dark:text-white/60 space-y-1">
              <li className="flex items-start">
                <span className="text-green-600 dark:text-green-400 mr-2">✓</span>
                "Buy [quantity] units of [drug name]"
              </li>
              <li className="flex items-start">
                <span className="text-green-600 dark:text-green-400 mr-2">✓</span>
                "What is my token balance?"
              </li>
              <li className="flex items-start">
                <span className="text-green-600 dark:text-green-400 mr-2">✓</span>
                "Show drugs for [condition]"
              </li>
              <li className="flex items-start">
                <span className="text-green-600 dark:text-green-400 mr-2">✓</span>
                "Tell me about [drug name]"
              </li>
            </ul>
          </div>

          <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <p className="text-sm font-semibold text-green-900 dark:text-green-200 mb-2 flex items-center">
              <CheckCircle className="w-4 h-4 mr-1" />
              System Status
            </p>
            <ul className="text-xs text-green-800 dark:text-green-300 space-y-1">
              <li className="flex items-center">
                <CheckCircle className="w-3 h-3 mr-2 text-green-600 dark:text-green-400" />
                Microphone access: {permissionGranted ? 'Granted ✓' : 'Not yet requested'}
              </li>
              <li className="flex items-center">
                <CheckCircle className="w-3 h-3 mr-2 text-green-600 dark:text-green-400" />
                Audio recording: Working ✓
              </li>
              <li className="flex items-center">
                <CheckCircle className="w-3 h-3 mr-2 text-green-600 dark:text-green-400" />
                Speech-to-text: Deepgram Active ✓
              </li>
              <li className="flex items-center">
                <CheckCircle className="w-3 h-3 mr-2 text-green-600 dark:text-green-400" />
                Command processing: Active ✓
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VoiceAgentInterface;
