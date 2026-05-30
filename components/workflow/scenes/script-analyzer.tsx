"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useSessionStore } from '@/lib/store';
import { LoadingSpinner } from '@/components/common/loading-spinner';
import { Card } from '@/components/ui/card';
import { FileSearch } from 'lucide-react';
import { countWords } from '@/lib/utils/word-count';
import { SECONDS_PER_SCENE } from '@/lib/constants';

interface ScriptAnalyzerProps {
  onComplete?: () => void;
}

export function ScriptAnalyzer({ onComplete }: ScriptAnalyzerProps) {
  const {
    script,
    setScenes,
    setGenerating,
    addError,
    clearErrors,
  } = useSessionStore();

  const hasAnalyzedRef = useRef(false);
  const [progressText, setProgressText] = useState<string>('Initializing scene analysis...');
  const [currentSceneCount, setCurrentSceneCount] = useState<number>(0);

  const analyzeScript = async () => {
    if (!script) {
      addError('No script available for analysis');
      return;
    }

    hasAnalyzedRef.current = true;
    clearErrors();

    // Use script content
    const scriptContent = script.content;

    setGenerating(true);
    setProgressText('Breaking your script into scenes...');

    try {
      const response = await fetch('/api/analyze/script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          script: scriptContent,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to analyze script');
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (!reader) {
        throw new Error('Response body is not readable');
      }

      setProgressText('Generating scenes...');

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines (separated by \n)
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);

            if (data.type === 'progress') {
              // Update progress text based on content
              const sceneMatches = data.text.match(/"scene_number":\s*(\d+)/g);
              if (sceneMatches) {
                const sceneNumbers = sceneMatches.map((m: string) =>
                  parseInt(m.match(/\d+/)?.[0] || '0')
                );
                const maxScene = Math.max(...sceneNumbers);
                if (maxScene > currentSceneCount) {
                  setCurrentSceneCount(maxScene);
                  setProgressText(`Generating scene ${maxScene}...`);
                }
              }
            } else if (data.type === 'complete') {
              setProgressText('Scene analysis complete!');
              setScenes(data.scenes);
              setGenerating(false);

              // Call the onComplete callback to move to next phase
              if (onComplete) {
                setTimeout(onComplete, 500); // Small delay for UX
              }
              return;
            } else if (data.type === 'error') {
              throw new Error(data.error || 'Unknown error during scene analysis');
            }
          } catch (parseError) {
            console.error('Error parsing streaming response:', parseError);
            // Continue processing other lines
          }
        }
      }
    } catch (error) {
      console.error('Script analysis error:', error);
      addError('Failed to analyze script. Please try again.');
      setGenerating(false);
      setProgressText('Error occurred');
    }
  };

  useEffect(() => {
    if (!hasAnalyzedRef.current && script) {
      analyzeScript();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Calculate expected scenes based on actual script word count
  const scriptContent = script?.content || '';
  const wordCount = countWords(scriptContent);
  const estimatedDurationMinutes = Math.ceil(wordCount / 150);
  const expectedScenes = Math.round((estimatedDurationMinutes * 60) / SECONDS_PER_SCENE); // ~30s per scene

  return (
    <Card className="p-8">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="relative">
            <FileSearch className="h-16 w-16 text-primary" />
            <div className="absolute -bottom-1 -right-1">
              <div className="animate-ping absolute h-3 w-3 bg-primary/40 rounded-full"></div>
              <div className="h-3 w-3 bg-primary rounded-full"></div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xl font-semibold font-serif">Breaking Your Script Into Scenes</h3>
          <p className="text-muted-foreground">
            Analyzing {wordCount}-word script (~{estimatedDurationMinutes} min narration)...
          </p>
          {currentSceneCount > 0 && (
            <p className="text-sm font-medium text-primary">
              Progress: {currentSceneCount} / ~{expectedScenes} scenes
            </p>
          )}
        </div>

        <LoadingSpinner size="lg" />

        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-primary rounded-full animate-pulse"></div>
            <span>{progressText}</span>
          </div>
          {currentSceneCount === 0 && (
            <>
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-primary rounded-full animate-pulse"></div>
                <span>Creating ~{expectedScenes} calming scenes (~{SECONDS_PER_SCENE}s each)</span>
              </div>
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-primary rounded-full animate-pulse"></div>
                <span>Preparing dark, dreamlike image prompts</span>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
