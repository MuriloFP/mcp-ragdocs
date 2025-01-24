import { QueueProgress } from './types.js';

export class QueueProgressTracker {
  private progress: QueueProgress;
  private updateCallback?: (progress: QueueProgress) => void;

  constructor(totalItems: number, updateCallback?: (progress: QueueProgress) => void) {
    this.progress = {
      totalItems,
      processing: [],
      completed: 0,
      failed: 0,
      errors: [],
      startTime: Date.now()
    };
    this.updateCallback = updateCallback;
  }

  private updateEstimatedTime() {
    const elapsed = Date.now() - this.progress.startTime;
    const itemsProcessed = this.progress.completed + this.progress.failed;
    if (itemsProcessed === 0) return;

    const avgTimePerItem = elapsed / itemsProcessed;
    const remainingItems = this.progress.totalItems - itemsProcessed;
    this.progress.estimatedTimeRemaining = avgTimePerItem * remainingItems;
  }

  private notifyUpdate() {
    this.updateEstimatedTime();
    if (this.updateCallback) {
      this.updateCallback(this.progress);
    }
  }

  startProcessing(items: string[]) {
    this.progress.processing = items;
    this.notifyUpdate();
  }

  completeItem(item: string) {
    this.progress.processing = this.progress.processing.filter(i => i !== item);
    this.progress.completed++;
    this.notifyUpdate();
  }

  failItem(item: string, error: string, attempts: number) {
    this.progress.processing = this.progress.processing.filter(i => i !== item);
    this.progress.failed++;
    this.progress.errors.push({ item, error, attempts });
    this.notifyUpdate();
  }

  getProgress(): QueueProgress {
    this.updateEstimatedTime();
    return { ...this.progress };
  }

  formatProgress(): string {
    const progress = this.getProgress();
    const total = progress.totalItems;
    const done = progress.completed + progress.failed;
    const percent = Math.round((done / total) * 100);
    
    let msg = `Progress: ${done}/${total} (${percent}%)\n`;
    msg += `✅ Completed: ${progress.completed}\n`;
    msg += `❌ Failed: ${progress.failed}\n`;
    
    if (progress.processing.length > 0) {
      msg += `\n🔄 Currently processing:\n${progress.processing.map(item => `  • ${item}`).join('\n')}\n`;
    }

    if (progress.estimatedTimeRemaining) {
      const minutes = Math.ceil(progress.estimatedTimeRemaining / 60000);
      msg += `\n⏱️ Estimated time remaining: ${minutes} minute${minutes !== 1 ? 's' : ''}\n`;
    }

    if (progress.errors.length > 0) {
      msg += `\n⚠️ Errors:\n${progress.errors.map(e => 
        `  • ${e.item} (${e.attempts} attempt${e.attempts !== 1 ? 's' : ''}): ${e.error}`
      ).join('\n')}\n`;
    }

    return msg;
  }
} 