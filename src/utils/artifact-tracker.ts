/**
 * ArtifactTracker - Tracks audio transition metrics for debugging
 * Identifies potential audio artifacts during chunk transitions
 */

export interface TransitionMetrics {
  fromChunk: number;
  toChunk: number;
  gapMs: number;
  hasCrossfade: boolean;
  crossfadeDurationMs: number;
  hasSentenceBoundary: boolean;
  zeroCrossingSuccess: boolean;
  setTimeoutDrift: number;
}

export class ArtifactTracker {
  private transitions: TransitionMetrics[] = [];

  record(metrics: TransitionMetrics): void {
    this.transitions.push(metrics);

    // Real-time warnings
    if (metrics.gapMs > 50) {
      console.warn(`⚠️ [ARTIFACT] Gap >50ms: ${metrics.gapMs}ms (chunk ${metrics.fromChunk}→${metrics.toChunk})`);
    }
    if (metrics.gapMs > 100) {
      console.error(`🚨 [ARTIFACT] CRITICAL gap: ${metrics.gapMs}ms`);
    }
    if (Math.abs(metrics.setTimeoutDrift) > 10) {
      console.warn(`⏱️ [ARTIFACT] setTimeout drift: ${metrics.setTimeoutDrift}ms`);
    }
  }

  getReport(): string {
    if (this.transitions.length === 0) return 'No transitions recorded';

    const gaps = this.transitions.map(t => t.gapMs);
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const maxGap = Math.max(...gaps);
    const criticalCount = gaps.filter(g => g > 100).length;
    const warningCount = gaps.filter(g => g > 50 && g <= 100).length;
    const zeroCrossingFailures = this.transitions.filter(t => !t.zeroCrossingSuccess).length;
    const sentenceFailures = this.transitions.filter(t => !t.hasSentenceBoundary && t.hasCrossfade).length;

    return `
📊 ============== ARTIFACT REPORT ==============
  Total transitions: ${this.transitions.length}
  Average gap: ${avgGap.toFixed(1)}ms
  Max gap: ${maxGap}ms
  ⚠️ Warning gaps (50-100ms): ${warningCount}
  🚨 Critical gaps (>100ms): ${criticalCount}
  ❌ Zero-crossing failures: ${zeroCrossingFailures}
  📝 Sentence boundary failures: ${sentenceFailures}
==============================================
    `;
  }

  reset(): void {
    this.transitions = [];
  }

  getTransitions(): TransitionMetrics[] {
    return [...this.transitions];
  }
}
