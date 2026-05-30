"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useSessionStore } from '@/lib/store';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { StoryboardScene } from '@/lib/types';
import { Film, CheckCircle, AlertCircle } from 'lucide-react';
import { MAX_GENERATED_IMAGES } from '@/lib/constants';

interface StoryboardGeneratorProps {
  onComplete?: () => void;
}

export function StoryboardGenerator({ onComplete }: StoryboardGeneratorProps) {
  const {
    scenes,
    storyboardScenes,
    setStoryboardScenes,
    updateStoryboardScene,
    setSceneGenerationProgress,
    sceneGenerationProgress,
  } = useSessionStore();

  const [generatingScenes, setGeneratingScenes] = useState(false);
  const [currentGeneratingScene, setCurrentGeneratingScene] = useState(0);
  const [imagePoolGenerated, setImagePoolGenerated] = useState(0);
  const hasGeneratedScenesRef = useRef(false);
  const imagePoolRef = useRef<string[]>([]); // Store the pool of generated image URLs

  const generateSceneImage = async (scene: StoryboardScene) => {
    try {
      updateStoryboardScene(scene.scene_number, {
        generation_status: 'generating',
      });

      const response = await fetch('/api/generate/scene-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scene,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate scene image');
      }

      const data = await response.json();
      console.log(`Scene ${scene.scene_number} generated with ${data.style} style`);

      updateStoryboardScene(scene.scene_number, {
        image_url: data.image_url,
        visual_prompt: data.prompt_used,
        generation_status: 'completed',
      });

      return true;
    } catch (error) {
      console.error(`Scene ${scene.scene_number} generation error:`, error);
      updateStoryboardScene(scene.scene_number, {
        generation_status: 'error',
        error_message: 'Failed to generate image',
      });
      return false;
    }
  };

  const generateAllScenes = async () => {
    hasGeneratedScenesRef.current = true;
    setGeneratingScenes(true);

    // Determine how many unique images to generate (capped by MAX_GENERATED_IMAGES)
    const totalScenes = scenes.length;
    const imagesToGenerate = Math.min(totalScenes, MAX_GENERATED_IMAGES);

    // Initialize storyboard scenes from regular scenes
    const initialStoryboardScenes: StoryboardScene[] = scenes.map((scene) => ({
      ...scene,
      generation_status: 'pending',
      image_url: undefined,
      image_pool_index: undefined,
    }));
    setStoryboardScenes(initialStoryboardScenes);

    // Call onComplete callback to switch to reviewing phase
    if (onComplete) {
      onComplete();
    }

    // PHASE 1: Generate one unique image per scene, up to the pool cap
    console.log(`Generating image pool: ${imagesToGenerate} unique images for ${totalScenes} scenes`);

    const imageGenerationPromises = scenes.slice(0, imagesToGenerate).map(async (scene, index) => {
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
            scene,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to generate scene image');
        }

        const data = await response.json();

        // Store in image pool
        imagePoolRef.current[index] = data.image_url;
        setImagePoolGenerated(prev => prev + 1);

        updateStoryboardScene(scene.scene_number, {
          image_url: data.image_url,
          visual_prompt: data.prompt_used,
          generation_status: 'completed',
          image_pool_index: index,
        });

        return data.image_url;
      } catch (error) {
        console.error(`Image pool generation error (index ${index}):`, error);
        updateStoryboardScene(scene.scene_number, {
          generation_status: 'error',
          error_message: 'Failed to generate image',
        });
        return null;
      }
    });

    // Wait for all unique images to be generated
    await Promise.all(imageGenerationPromises);

    // PHASE 2: Cover any overflow scenes.
    // When totalScenes <= the image pool, every scene already has its OWN
    // topic-matched image from phase 1 — leave that 1:1 mapping intact.
    // Only longer videos (more scenes than the pool) reuse images, and only for
    // the extra scenes beyond the pool, distributed from a shuffled pool.
    if (totalScenes > imagesToGenerate) {
      console.log('Distributing pooled images across overflow scenes...');
      const shuffledIndices = Array.from({ length: imagesToGenerate }, (_, i) => i)
        .sort(() => Math.random() - 0.5);

      for (let i = imagesToGenerate; i < totalScenes; i++) {
        const poolIndex = shuffledIndices[i % imagesToGenerate];
        const imageUrl = imagePoolRef.current[poolIndex];

        if (imageUrl) {
          updateStoryboardScene(scenes[i].scene_number, {
            image_url: imageUrl,
            generation_status: 'completed',
            image_pool_index: poolIndex,
          });
        }
      }
    }

    setGeneratingScenes(false);
    console.log(`✓ Complete: ${imagesToGenerate} unique images across ${totalScenes} scenes`);
  };

  useEffect(() => {
    if (!hasGeneratedScenesRef.current && scenes.length > 0 && storyboardScenes.length === 0) {
      generateAllScenes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completedScenes = storyboardScenes.filter((s) => s.generation_status === 'completed').length;
  const errorScenes = storyboardScenes.filter((s) => s.generation_status === 'error').length;
  const totalScenes = scenes.length;
  const imagesToGenerate = Math.min(totalScenes, MAX_GENERATED_IMAGES);
  const estimatedCost = (imagesToGenerate * 0.004).toFixed(2);
  const savedCost = totalScenes > MAX_GENERATED_IMAGES
    ? ((totalScenes - MAX_GENERATED_IMAGES) * 0.004).toFixed(2)
    : '0.00';

  // Update progress tracking based on actual completed scenes
  useEffect(() => {
    if (storyboardScenes.length > 0) {
      setCurrentGeneratingScene(completedScenes);
      const progress = (imagePoolGenerated / imagesToGenerate) * 100;
      setSceneGenerationProgress(progress);
    }
  }, [completedScenes, imagePoolGenerated, imagesToGenerate, storyboardScenes.length, setCurrentGeneratingScene, setSceneGenerationProgress]);

  return (
    <Card className="p-8">
      <div className="text-center space-y-6">
        <div className="flex justify-center">
          <div className="relative">
            <Film className="h-16 w-16 text-primary" />
            {generatingScenes && (
              <div className="absolute -bottom-1 -right-1">
                <div className="animate-ping absolute h-3 w-3 bg-primary/40 rounded-full"></div>
                <div className="h-3 w-3 bg-primary rounded-full"></div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xl font-semibold font-serif">Generating Image Library</h3>
          <p className="text-muted-foreground">
            {imagePoolGenerated < imagesToGenerate
              ? `Creating ${imagesToGenerate} unique images for ${totalScenes} scenes`
              : `Distributing ${imagesToGenerate} images across ${totalScenes} scenes`}
          </p>
          {totalScenes > MAX_GENERATED_IMAGES && (
            <p className="text-sm text-green-600 dark:text-green-400 font-medium">
              Cost optimized: ${estimatedCost} (saving ${savedCost})
            </p>
          )}
        </div>

        {/* Progress Information */}
        <div className="space-y-4 max-w-md mx-auto">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Image Pool Progress</span>
              <span className="font-medium">
                {imagePoolGenerated} / {imagesToGenerate} unique images
              </span>
            </div>
            <Progress value={sceneGenerationProgress} className="h-2" />
            {totalScenes > imagesToGenerate && (
              <p className="text-xs text-muted-foreground text-center">
                {imagesToGenerate} images will be distributed across all {totalScenes} scenes
              </p>
            )}
          </div>

          {/* Status Badges */}
          <div className="flex items-center justify-center gap-2">
            {completedScenes > 0 && (
              <Badge variant="default" className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                {completedScenes} Completed
              </Badge>
            )}
            {errorScenes > 0 && (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errorScenes} Failed
              </Badge>
            )}
            {generatingScenes && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                Generating
              </Badge>
            )}
          </div>
        </div>

        {/* Scene Grid Preview */}
        <div className="grid grid-cols-4 gap-2 mt-6">
          {storyboardScenes.map((scene) => (
            <div
              key={scene.scene_number}
              className={`
                aspect-video rounded border-2 flex items-center justify-center
                ${scene.generation_status === 'completed' ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : ''}
                ${scene.generation_status === 'generating' ? 'border-primary bg-primary/10' : ''}
                ${scene.generation_status === 'error' ? 'border-destructive bg-destructive/10' : ''}
                ${scene.generation_status === 'pending' ? 'border-border bg-muted/50' : ''}
              `}
            >
              {scene.generation_status === 'completed' ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : scene.generation_status === 'generating' ? (
                <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
              ) : scene.generation_status === 'error' ? (
                <AlertCircle className="h-4 w-4 text-destructive" />
              ) : (
                <div className="text-xs text-muted-foreground">{scene.scene_number}</div>
              )}
            </div>
          ))}
        </div>

        <div className="text-sm text-muted-foreground space-y-1">
          <p>Images generated with a dark, calming, cinematic style.</p>
          {totalScenes > MAX_GENERATED_IMAGES ? (
            <p className="text-xs">
              Generating {imagesToGenerate} unique images, randomly distributed across {totalScenes} scenes
            </p>
          ) : (
            <p className="text-xs">
              Generating {imagesToGenerate} unique images for {totalScenes} scenes
            </p>
          )}
          <p className="text-xs">Using Grok Imagine (xAI) at 2k, 16:9</p>
        </div>
      </div>
    </Card>
  );
}
