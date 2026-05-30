import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  Script,
  Scene,
  StoryboardScene,
  WorkflowStep
} from '../types';
import { SCENE_DURATION_SECONDS } from '../config/development';

interface ExportData {
  script: Script | null;
  scenes: Scene[];
  storyboardScenes: StoryboardScene[];
  currentStep?: WorkflowStep;
}

// Helper function to pad numbers with zeros
function padNumber(num: number, digits: number = 3): string {
  return String(num).padStart(digits, '0');
}

// Helper function to extract file extension from URL
function getFileExtension(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    return match ? match[1] : 'jpg'; // Default to jpg if no extension found
  } catch {
    return 'jpg';
  }
}

// Helper function to fetch media file from URL
async function fetchMediaFile(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);
    return await response.blob();
  } catch (error) {
    console.error(`Error fetching media from ${url}:`, error);
    return null;
  }
}

// Create FFmpeg manifest for video assembly
function createFFmpegManifest(data: ExportData): string {
  let manifest = '# FFmpeg Assembly Manifest\n';
  manifest += '# Generated on ' + new Date().toISOString() + '\n\n';

  // Video assembly command example
  manifest += '## Example FFmpeg Commands\n\n';

  // Image sequence to video
  manifest += `### Create video from image sequence (${SCENE_DURATION_SECONDS} seconds per scene):\n`;
  manifest += '```bash\n';
  manifest += `ffmpeg -framerate 1/${SCENE_DURATION_SECONDS} -i media/scenes/scene_%03d.jpg -c:v libx264 -pix_fmt yuv420p scenes_video.mp4\n`;
  manifest += '```\n\n';

  // Add audio instructions
  manifest += '### Add audio to video:\n';
  manifest += '```bash\n';
  manifest += 'ffmpeg -i scenes_video.mp4 -i your_audio.mp3 -c:v copy -c:a aac final_video.mp4\n';
  manifest += '```\n\n';

  // Scene timing information
  manifest += '## Scene Timing Information:\n';
  data.storyboardScenes.forEach((scene, index) => {
    manifest += `Scene ${padNumber(index + 1)}: ${scene.script_snippet?.substring(0, 50)}...\n`;
  });

  return manifest;
}

// Create assembly guide markdown
function createAssemblyGuide(data: ExportData): string {
  let guide = '# Video Assembly Guide\n\n';
  guide += `## Project: Sleep Stories Export\n`;
  guide += `Generated on: ${new Date().toLocaleString()}\n\n`;

  guide += '## File Structure\n\n';
  guide += '```\n';
  guide += 'media/\n';
  guide += '└── scenes/         # Sequential scene images\n';
  guide += '```\n\n';

  guide += '## Assets Summary\n\n';
  guide += `- **Scenes**: ${data.storyboardScenes.filter(s => s.image_url).length} images (${SCENE_DURATION_SECONDS} seconds each)\n`;
  guide += `- **Scene Pacing**: ${SCENE_DURATION_SECONDS} seconds per scene\n\n`;

  guide += '## Assembly Steps\n\n';
  guide += '1. **Review Assets**: Check all media files are present\n';
  guide += '2. **Add Audio**: Generate or add your own narration audio\n';
  guide += '3. **Create Video from Scenes**: Use scene images to create video track\n';
  guide += '4. **Combine Tracks**: Merge video and audio into final output\n';
  guide += '5. **Add Transitions**: Optional - add fade effects between scenes\n\n';

  guide += '## Scene Breakdown\n\n';
  data.storyboardScenes.forEach((scene, index) => {
    guide += `### Scene ${padNumber(index + 1)}\n`;
    guide += `- **File**: scene_${padNumber(index + 1)}.${scene.image_url ? getFileExtension(scene.image_url) : 'jpg'}\n`;
    guide += `- **Script**: ${scene.script_snippet?.substring(0, 100)}...\n\n`;
  });

  return guide;
}

// Create scene timeline JSON for advanced editing
function createSceneTimeline(data: ExportData): object {
  const timeline = {
    project: 'Sleep Stories',
    total_scenes: data.storyboardScenes.length,
    scenes: data.storyboardScenes.map((scene, index) => ({
      scene_number: index + 1,
      filename: `scene_${padNumber(index + 1)}.jpg`,
      script_excerpt: scene.script_snippet?.substring(0, 100),
      suggested_duration_seconds: scene.duration ?? SCENE_DURATION_SECONDS,
    }))
  };

  return timeline;
}

export async function createExportZip(data: ExportData): Promise<void> {
  const zip = new JSZip();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const projectName = 'sleep-stories';
  
  // Create media folders
  const mediaFolder = zip.folder('media');
  const scenesFolder = mediaFolder?.folder('scenes');
  const productionFolder = zip.folder('production');

  // Download and add scene images with sequential naming (following script order)
  if (scenesFolder && data.storyboardScenes.length > 0) {
    for (let i = 0; i < data.storyboardScenes.length; i++) {
      const scene = data.storyboardScenes[i];
      if (scene.image_url) {
        const blob = await fetchMediaFile(scene.image_url);
        if (blob) {
          const ext = getFileExtension(scene.image_url);
          const filename = `scene_${padNumber(i + 1)}.${ext}`;
          scenesFolder.file(filename, blob);
        }
      }
    }
    
    // Add scenes metadata
    scenesFolder.file('scenes_metadata.json', JSON.stringify(
      data.storyboardScenes.map((scene, idx) => ({
        filename: `scene_${padNumber(idx + 1)}.jpg`,
        scene_number: scene.scene_number,
        script_snippet: scene.script_snippet,
        visual_prompt: scene.visual_prompt
      })), null, 2
    ));
  }

  // Add production files
  if (productionFolder) {
    productionFolder.file('ffmpeg_manifest.txt', createFFmpegManifest(data));
    productionFolder.file('assembly_guide.md', createAssemblyGuide(data));
    productionFolder.file('scene_timeline.json', JSON.stringify(createSceneTimeline(data), null, 2));
  }
  
  // Add main metadata file
  const metadata = {
    exportedAt: new Date().toISOString(),
    projectName,
    wordCount: data.script?.word_count,
    currentStep: data.currentStep,
    assetCounts: {
      scenes: data.scenes.length,
      storyboardScenes: data.storyboardScenes.filter(s => s.image_url).length
    }
  };
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));
  
  // Add script
  if (data.script) {
    zip.file('script.txt', data.script.content);
    zip.file('script.md', `# Sleep Stories Script\n\n${data.script.content}`);
  }
  
  // Generate and download the zip file
  const blob = await zip.generateAsync({ 
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  saveAs(blob, `${projectName}_${timestamp}.zip`);
}
