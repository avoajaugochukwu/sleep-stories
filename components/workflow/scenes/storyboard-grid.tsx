"use client";

import React, { useState } from 'react';
import { useSessionStore } from '@/lib/store';
import { StoryboardScene } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SceneEditor } from './scene-editor';
import { 
  Grid3x3,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Image as ImageIcon,
  Edit
} from 'lucide-react';

export function StoryboardGrid() {
  const {
    storyboardScenes,
    updateStoryboardScene,
  } = useSessionStore();

  const [selectedScene, setSelectedScene] = useState<StoryboardScene | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const openSceneEditor = (scene: StoryboardScene) => {
    setSelectedScene(scene);
    setIsEditorOpen(true);
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (!selectedScene) return;
    
    const currentIndex = storyboardScenes.findIndex(
      s => s.scene_number === selectedScene.scene_number
    );
    
    if (direction === 'prev' && currentIndex > 0) {
      setSelectedScene(storyboardScenes[currentIndex - 1]);
    } else if (direction === 'next' && currentIndex < storyboardScenes.length - 1) {
      setSelectedScene(storyboardScenes[currentIndex + 1]);
    }
  };

  const regenerateFailedScenes = async () => {
    const failedScenes = storyboardScenes.filter(s => s.generation_status === 'error');
    
    for (const scene of failedScenes) {
      updateStoryboardScene(scene.scene_number, {
        generation_status: 'generating',
      });

      try {
        const response = await fetch('/api/generate/scene-image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            scene
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to regenerate scene');
        }

        const { image_url, prompt_used } = await response.json();
        
        updateStoryboardScene(scene.scene_number, {
          image_url,
          visual_prompt: prompt_used,
          generation_status: 'completed',
        });
      } catch (error) {
        console.error(`Failed to regenerate scene ${scene.scene_number}:`, error);
        updateStoryboardScene(scene.scene_number, {
          generation_status: 'error',
        });
      }
    }
  };


  const completedScenes = storyboardScenes.filter(s => s.generation_status === 'completed').length;
  const errorScenes = storyboardScenes.filter(s => s.generation_status === 'error').length;
  const allScenesCompleted = completedScenes === storyboardScenes.length;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h3 className="font-display text-2xl">Review your storyboard</h3>
        <p className="text-muted-foreground">
          Click on any scene to view details or regenerate the image
        </p>
        
        <div className="flex items-center justify-center gap-2 mt-4">
          <Badge variant={allScenesCompleted ? "default" : "outline"}>
            <Grid3x3 className="h-3 w-3 mr-1" />
            {completedScenes} / {storyboardScenes.length} scenes
          </Badge>
          {errorScenes > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={regenerateFailedScenes}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry {errorScenes} Failed
            </Button>
          )}
        </div>
      </div>

      {/* Storyboard Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {storyboardScenes.map((scene) => (
          <Card
            key={scene.scene_number}
            className={`
              cursor-pointer transition-all hover:shadow-lg
              ${scene.generation_status === 'error' ? 'ring-2 ring-destructive' : ''}
              ${scene.is_regenerating ? 'opacity-75' : ''}
            `}
            onClick={() => openSceneEditor(scene)}
          >
            <CardContent className="p-4 space-y-3">
              {/* Scene Number and Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Badge variant="outline">Scene {scene.scene_number}</Badge>
                  {scene.image_pool_index !== undefined && (
                    <Badge variant="secondary" className="text-xs">
                      #{scene.image_pool_index + 1}
                    </Badge>
                  )}
                </div>
                {scene.generation_status === 'completed' && (
                  <CheckCircle className="h-4 w-4 text-success" />
                )}
                {scene.generation_status === 'error' && (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                )}
                {scene.generation_status === 'generating' && (
                  <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                )}
              </div>

              {/* Scene Image */}
              <div className="relative aspect-video bg-secondary/50 rounded-lg overflow-hidden group">
                {scene.image_url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={scene.image_url}
                      alt={`Scene ${scene.scene_number}`}
                      className="w-full h-full object-cover"
                      onError={() => console.error(`Failed to load image for scene ${scene.scene_number}`)}
                    />
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-all flex items-center justify-center pointer-events-none group-hover:pointer-events-auto">
                      <Edit className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground/60">
                    <ImageIcon className="h-8 w-8 mb-1" />
                    <span className="text-xs">No image</span>
                  </div>
                )}
              </div>

              {/* Scene Description */}
              <p className="text-sm text-muted-foreground line-clamp-2">
                {scene.script_snippet}
              </p>

            </CardContent>
          </Card>
        ))}
      </div>

      {/* Scene Editor Dialog */}
      <SceneEditor
        scene={selectedScene}
        isOpen={isEditorOpen}
        onClose={() => {
          setIsEditorOpen(false);
          setSelectedScene(null);
        }}
        onNavigate={handleNavigate}
      />
    </div>
  );
}