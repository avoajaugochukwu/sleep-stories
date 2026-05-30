"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '@/lib/store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NavigationButtons } from '@/components/common/navigation-buttons';
import { ErrorDisplay } from '@/components/common/error-display';
import {
  Download,
  FileText,
  FileJson,
  CheckCircle,
  Package,
  Files
} from 'lucide-react';
import { createExportZip } from '@/lib/utils/export';

export function ExportPanel() {
  const router = useRouter();
  const {
    currentStep,
    script,
    scenes,
    storyboardScenes,
    errors,
    addError,
    clearErrors,
  } = useSessionStore();

  const [isExporting, setIsExporting] = useState(false);
  const [exportComplete, setExportComplete] = useState(false);

  const handlePrevious = () => {
    router.push('/render');
  };

  const getEstimatedSize = () => {
    let size = 0;
    if (script) size += script.word_count * 6; // ~6 bytes per word
    if (scenes) size += scenes.length * 500; // ~500 bytes per scene
    if (storyboardScenes) size += storyboardScenes.length * 1000; // ~1KB per storyboard scene (without images)

    if (size < 1024) return `${size} bytes`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleExport = async () => {
    clearErrors();
    setIsExporting(true);
    setExportComplete(false);

    try {
      await createExportZip({
        script,
        scenes,
        storyboardScenes,
        currentStep,
      });
      setExportComplete(true);
    } catch (error) {
      console.error('Export error:', error);
      addError('Failed to create export. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const exportItems = [
    {
      name: 'Full Script',
      available: !!script,
      icon: FileText,
      description: 'Complete narrative text',
    },
    {
      name: 'Scene Breakdown',
      available: scenes.length > 0,
      icon: Files,
      description: `${scenes.length} scenes with generated images`,
    },
  ];

  const availableCount = exportItems.filter(item => item.available).length;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-display text-2xl mb-2">Export your story</h2>
        <p className="text-muted-foreground">
          Download all generated content as a ZIP file
        </p>
      </div>

      <ErrorDisplay errors={errors} onDismiss={() => clearErrors()} />

      <Card>
        <CardHeader>
          <CardTitle>Export Summary</CardTitle>
          <CardDescription>
            {availableCount} of {exportItems.length} components ready for export
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {exportItems.map((item, index) => (
            <div key={index} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <item.icon className={`h-5 w-5 ${
                  item.available ? 'text-success' : 'text-muted-foreground'
                }`} />
                <div>
                  <p className={`text-sm font-medium ${
                    !item.available && 'text-muted-foreground'
                  }`}>
                    {item.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </div>
              {item.available ? (
                <CheckCircle className="h-5 w-5 text-success" />
              ) : (
                <Badge variant="outline" className="text-xs">
                  Not Available
                </Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Project Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {script && (
            <>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Word Count:</span>
                <span className="text-sm font-medium">{script.word_count} words</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Estimated Duration:</span>
                <span className="text-sm font-medium">{Math.round((script.word_count / 150) * 10) / 10} minutes</span>
              </div>
            </>
          )}
          <div className="flex justify-between pt-2 border-t">
            <span className="text-sm text-muted-foreground">Estimated Size:</span>
            <span className="text-sm font-medium">{getEstimatedSize()}</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col items-center gap-4">
        {exportComplete && (
          <div className="flex items-center gap-2 text-success">
            <CheckCircle className="h-5 w-5" />
            <span className="font-medium">Export completed successfully!</span>
          </div>
        )}
        
        <Button
          size="lg"
          onClick={handleExport}
          disabled={isExporting || availableCount === 0}
          className="min-w-[200px]"
        >
          {isExporting ? (
            <>
              <Package className="mr-2 h-4 w-4 animate-pulse" />
              Creating ZIP...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Download ZIP File
            </>
          )}
        </Button>
      </div>

      <NavigationButtons
        onPrevious={handlePrevious}
        nextDisabled={true}
        nextLabel="Complete"
      />
    </div>
  );
}