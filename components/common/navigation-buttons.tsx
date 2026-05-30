"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useSessionStore } from '@/lib/store';
import { WorkflowStep } from '@/lib/types';

interface NavigationButtonsProps {
  onNext?: () => void;
  onPrevious?: () => void;
  nextDisabled?: boolean;
  previousDisabled?: boolean;
  nextLabel?: string;
  showReset?: boolean;
}

export function NavigationButtons({
  onNext,
  onPrevious,
  nextDisabled = false,
  previousDisabled = false,
  nextLabel = "Next",
  showReset = true,
}: NavigationButtonsProps) {
  const { currentStep, reset, setStep } = useSessionStore();

  const handlePrevious = () => {
    if (onPrevious) {
      onPrevious();
    } else if (currentStep > 1) {
      setStep((currentStep - 1) as WorkflowStep);
    }
  };

  const handleNext = () => {
    if (onNext) {
      onNext();
    } else if (currentStep < 4) {
      setStep((currentStep + 1) as WorkflowStep);
    }
  };

  const handleReset = () => {
    if (confirm('Are you sure you want to start over? All current progress will be lost.')) {
      reset();
    }
  };

  return (
    <div className="flex items-center justify-between mt-8">
      <Button
        variant="outline"
        onClick={handlePrevious}
      >
        <ChevronLeft className="mr-2 h-4 w-4" />
        Previous
      </Button>

      {showReset && (
        <Button
          variant="ghost"
          onClick={handleReset}
          className="text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Start Over
        </Button>
      )}

      <Button
        onClick={handleNext}
        disabled={nextDisabled}
      >
        {nextLabel}
        {nextLabel === "Next" && <ChevronRight className="ml-2 h-4 w-4" />}
      </Button>
    </div>
  );
}