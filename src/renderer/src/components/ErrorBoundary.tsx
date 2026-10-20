import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Uncaught React render error:', error, errorInfo)
  }

  private handleReset = (): void => {
    try {
      useAppStore.getState().setView({ name: 'list' })
    } catch {}
    this.setState({ hasError: false, error: null })
  }

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-background p-6 text-foreground">
          <div className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 text-center shadow-lg">
            <div className="flex size-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <AlertCircle className="size-6" />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-[16px] font-semibold">Render Error Caught</h2>
              <p className="text-[12.5px] text-muted-foreground">
                An issue occurred while rendering the interface.
              </p>
            </div>
            {this.state.error && (
              <div className="w-full rounded-md border border-border/60 bg-muted/30 p-2.5 text-left font-mono text-[11px] text-destructive overflow-x-auto max-h-32">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}
            <button
              type="button"
              onClick={this.handleReset}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-sans text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
            >
              <RotateCcw className="size-4" />
              Return to Downloads List
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
