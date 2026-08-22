export type StatusTone = 'neutral' | 'working' | 'good' | 'warning' | 'error';

export class StatusPill {
  public readonly element: HTMLElement;
  private readonly label: HTMLElement;

  constructor(initialLabel: string) {
    this.element = document.createElement('div');
    this.element.className = 'status-pill';
    this.element.innerHTML = '<span class="status-pip" aria-hidden="true"></span><span class="status-label"></span>';
    const label = this.element.querySelector<HTMLElement>('.status-label');
    if (!label) throw new Error('Status label could not be created.');
    this.label = label;
    this.set(initialLabel, 'neutral');
  }

  set(text: string, tone: StatusTone): void {
    this.label.textContent = text;
    this.element.dataset.tone = tone;
  }
}
