// Error state for a part of a screen: a render error shows a plain message and a retry,
// instead of a blank screen.
import { Component, type ReactNode } from 'react';

export class Boundary extends Component<{ what: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn(`${this.props.what} failed to render`, e);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="boundary" role="alert">
        <p>Couldn't show {this.props.what}.</p>
        <button type="button" className="log-btn" onClick={() => this.setState({ failed: false })}>Try again</button>
      </div>
    );
  }
}
