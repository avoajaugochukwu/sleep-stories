"use client";

import React, { useState } from 'react';
import { useSessionStore } from '@/lib/store';
import { StoryboardScene } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/common/loading-spinner';
import { 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight,
  Save,
  X,
  Image as ImageIcon
} from 'lucide-react';

interface SceneEditorProps {
  scene: StoryboardScene | null;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
}

export function SceneEditor({ scene, isOpen, onClose, onNavigate }: SceneEditorProps) {
  const {
    updateStoryboardScene,
    storyboardScenes,
  } = useSessionStore();

  const [editedPrompt, setEditedPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  React.useEffect(() => {
    if (scene) {
      setEditedPrompt(scene.visual_prompt);
      setIsEditing(false);
    }
  }, [scene]);

  const handleRegenerate = async () => {
    if (!scene) return;

    setIsRegenerating(true);
    updateStoryboardScene(scene.scene_number, {
      is_regenerating: true,
      generation_status: 'generating',
    });

    try {
      const response = await fetch('/api/generate/scene-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scene: {
            ...scene,
            visual_prompt: isEditing ? editedPrompt : scene.visual_prompt,
          }
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
        is_regenerating: false,
      });
      
      setIsEditing(false);
    } catch (error) {
      console.error('Scene regeneration error:', error);
      updateStoryboardScene(scene.scene_number, {
        generation_status: 'error',
        error_message: 'Failed to regenerate image',
        is_regenerating: false,
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleSavePrompt = () => {
    if (scene) {
      updateStoryboardScene(scene.scene_number, {
        visual_prompt: editedPrompt,
      });
      handleRegenerate();
    }
  };

  if (!scene) return null;

  const currentIndex = storyboardScenes.findIndex(s => s.scene_number === scene.scene_number);
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < storyboardScenes.length - 1;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>Scene {scene.scene_number}</span>
              <Badge variant="outline" className="text-xs">
                Z-Image
              </Badge>
              {scene.image_pool_index !== undefined && (
                <Badge variant="secondary" className="text-xs">
                  Image #{scene.image_pool_index + 1}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleRegenerate}
                disabled={isRegenerating || isEditing}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${isRegenerating ? 'animate-spin' : ''}`} />
                Regenerate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate('prev')}
                disabled={!hasPrevious}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate('next')}
                disabled={!hasNext}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Scene Image */}
          <div className="relative aspect-video bg-secondary/50 rounded-lg overflow-hidden">
            {isRegenerating ? (
              <div className="flex items-center justify-center h-full">
                <LoadingSpinner size="lg" text="Regenerating scene..." />
              </div>
            ) : scene.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={scene.image_url}
                alt={`Scene ${scene.scene_number}`}
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <ImageIcon className="h-16 w-16 mb-2" />
                <span>No image generated</span>
              </div>
            )}

            {scene.generation_status === 'error' && (
              <div className="absolute inset-x-0 bottom-0 bg-destructive text-destructive-foreground p-2 text-sm">
                {scene.error_message || 'Generation failed'}
              </div>
            )}
          </div>

          {/* Script Snippet */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Scene Script:</label>
            <div className="p-3 bg-secondary/40 rounded-md">
              <p className="text-sm">{scene.script_snippet}</p>
            </div>
          </div>

          {/* Visual Prompt */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Visual Description:</label>
              {!isEditing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                >
                  Edit Description
                </Button>
              )}
            </div>
            
            {isEditing ? (
              <div className="space-y-2">
                <Textarea
                  value={editedPrompt}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  className="min-h-[100px]"
                  placeholder="Describe the visual scene..."
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSavePrompt}
                    disabled={isRegenerating}
                  >
                    <Save className="h-4 w-4 mr-1" />
                    Save & Regenerate
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setIsEditing(false);
                      setEditedPrompt(scene.visual_prompt);
                    }}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-secondary/40 rounded-md">
                <p className="text-sm">{scene.visual_prompt}</p>
              </div>
            )}
          </div>

        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
          >
            Close
          </Button>
          <Button
            onClick={handleRegenerate}
            disabled={isRegenerating || isEditing}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Regenerate Image
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}