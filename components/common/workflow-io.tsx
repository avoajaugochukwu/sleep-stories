"use client";

import React from 'react';
import toast from 'react-hot-toast';
import { Download, Upload, FileJson } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  exportWorkflow,
  parseWorkflowFile,
  applyWorkflow,
  currentWorkflowSummary,
  type ParsedWorkflow,
} from '@/lib/utils/workflow-io';

const pill =
  'flex items-center gap-2 rounded-full border border-border/60 px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground hover:border-border';

function summaryLine(s: { scenes: number; images: number; hasAudio: boolean; words: number }) {
  const parts = [
    `${s.scenes} scene${s.scenes === 1 ? '' : 's'}`,
    `${s.images} image${s.images === 1 ? '' : 's'}`,
    s.hasAudio ? 'audio linked' : 'no audio',
  ];
  if (s.words) parts.unshift(`${s.words.toLocaleString()} words`);
  return parts.join(' · ');
}

export function WorkflowIO() {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<ParsedWorkflow | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const handleExport = () => {
    const result = exportWorkflow();
    if (result.ok) toast.success('Workflow exported');
    else toast.error(result.reason ?? 'Nothing to export');
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseWorkflowFile(text);
      const existing = currentWorkflowSummary();
      if (existing) {
        // Something is already loaded — confirm before clobbering it.
        setPending(parsed);
        setConfirmOpen(true);
      } else {
        applyWorkflow(parsed.state);
        toast.success('Workflow imported');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not import that file');
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    e.target.value = '';
    if (file) void handleFile(file);
  };

  const confirmImport = () => {
    if (!pending) return;
    applyWorkflow(pending.state);
    toast.success('Workflow imported');
    setPending(null);
    setConfirmOpen(false);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onInputChange}
      />

      <button onClick={handleExport} className={pill} title="Export this workflow as a JSON file">
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">Export</span>
      </button>

      <button
        onClick={() => fileInputRef.current?.click()}
        className={pill}
        title="Import a workflow from a JSON file"
      >
        <Upload className="h-4 w-4" />
        <span className="hidden sm:inline">Import</span>
      </button>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setPending(null);
        }}
      >
        <DialogContent className="border-border/60">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display">
              <FileJson className="h-5 w-5 text-primary" />
              Replace current workflow?
            </DialogTitle>
            <DialogDescription>
              Importing will overwrite the script, scenes and audio you have loaded now. This
              can’t be undone.
            </DialogDescription>
          </DialogHeader>

          {pending && (
            <div className="rounded-lg border border-border/60 bg-secondary/30 p-3 text-sm">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Importing
              </div>
              <div className="mt-1 text-foreground">{summaryLine(pending.summary)}</div>
              {pending.summary.exportedAt && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Exported {new Date(pending.summary.exportedAt).toLocaleString()}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmImport}>
              <Upload className="mr-2 h-4 w-4" />
              Replace &amp; import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
