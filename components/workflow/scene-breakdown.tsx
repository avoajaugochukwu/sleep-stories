"use client";

import React, { useState } from 'react';
import { useSessionStore } from '@/lib/store';
import { ScriptAnalyzer } from './scenes/script-analyzer';
import { StoryboardGenerator } from './scenes/storyboard-generator';
import { StoryboardGrid } from './scenes/storyboard-grid';

type ScenePhase = 'analyzing' | 'generating' | 'reviewing';

export function SceneBreakdown() {
  const { script, scenes, storyboardScenes } = useSessionStore();

  // Initialize phase based on existing data to prevent re-generation on remount
  const [phase, setPhase] = useState<ScenePhase>(() => {
    // If storyboardScenes exist, skip to reviewing phase
    if (storyboardScenes && storyboardScenes.length > 0) {
      return 'reviewing';
    }
    // If scenes exist but no storyboard yet, skip to generating
    if (scenes && scenes.length > 0) {
      return 'generating';
    }
    // Otherwise start from analyzing
    return 'analyzing';
  });

  // If no script, show placeholder
  if (!script) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">
          Please generate a script first before creating scenes.
        </p>
      </div>
    );
  }

  // Automatically advance to generating phase when scenes are analyzed
  const handleScenesAnalyzed = () => {
    setPhase('generating');
  };

  // Automatically advance to reviewing phase when generation starts
  const handleGenerationStarted = () => {
    setPhase('reviewing');
  };

  // Render the appropriate phase
  const renderPhase = () => {
    switch (phase) {
      case 'analyzing':
        return <ScriptAnalyzer onComplete={handleScenesAnalyzed} />;
      case 'generating':
        return <StoryboardGenerator onComplete={handleGenerationStarted} />;
      case 'reviewing':
        return <StoryboardGrid />;
      default:
        return <ScriptAnalyzer onComplete={handleScenesAnalyzed} />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold font-serif mb-2">Scene Generation</h2>
        <p className="text-muted-foreground">
          Breaking your script into long, calming scenes with dark cinematic imagery
        </p>
      </div>

      {renderPhase()}
    </div>
  );
}
