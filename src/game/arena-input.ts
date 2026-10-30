function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export class ArenaInput {
  private readonly keys = new Set<string>();
  private readonly listeners: Array<() => void> = [];
  private externalMoveX = 0;
  private externalMoveY = 0;
  private externalFire = false;
  private mouseFire = false;
  private dashQueued = false;
  pointerX = window.innerWidth / 2;
  pointerY = window.innerHeight / 2;
  pointerActive = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.on(window, "keydown", (event) => {
      const keyboard = event as KeyboardEvent;
      if (isTyping(keyboard.target)) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(keyboard.code)) keyboard.preventDefault();
      this.keys.add(keyboard.code);
      if (!keyboard.repeat && (keyboard.code === "ShiftLeft" || keyboard.code === "ShiftRight")) this.dashQueued = true;
    });
    this.on(window, "keyup", (event) => this.keys.delete((event as KeyboardEvent).code));
    this.on(window, "blur", () => this.reset());
    this.on(document, "visibilitychange", () => {
      if (document.hidden) this.reset();
    });
    this.on(canvas, "pointermove", (event) => {
      const pointer = event as PointerEvent;
      if (pointer.pointerType === "mouse" || pointer.pointerType === "pen") {
        this.pointerX = pointer.clientX;
        this.pointerY = pointer.clientY;
        this.pointerActive = true;
      }
    });
    this.on(canvas, "pointerdown", (event) => {
      const pointer = event as PointerEvent;
      if (pointer.pointerType === "mouse" && pointer.button === 0) {
        this.mouseFire = true;
        this.pointerX = pointer.clientX;
        this.pointerY = pointer.clientY;
        this.pointerActive = true;
      }
    });
    this.on(window, "pointerup", () => {
      this.mouseFire = false;
    });
    this.on(canvas, "contextmenu", (event) => event.preventDefault());
  }

  private on(target: Window | Document | HTMLCanvasElement, event: string, handler: (event: Event) => void): void {
    target.addEventListener(event, handler);
    this.listeners.push(() => target.removeEventListener(event, handler));
  }

  get moveX(): number {
    const keyboard = (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    return Math.max(-1, Math.min(1, keyboard + this.externalMoveX));
  }

  get moveY(): number {
    const keyboard = (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0) -
      (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0);
    return Math.max(-1, Math.min(1, keyboard + this.externalMoveY));
  }

  get firing(): boolean {
    return this.mouseFire || this.externalFire || this.keys.has("Space");
  }

  setMove(x: number, y: number): void {
    this.externalMoveX = Math.max(-1, Math.min(1, x));
    this.externalMoveY = Math.max(-1, Math.min(1, y));
  }

  setFiring(value: boolean): void {
    this.externalFire = value;
  }

  queueDash(): void {
    this.dashQueued = true;
  }

  consumeDash(): boolean {
    const queued = this.dashQueued;
    this.dashQueued = false;
    return queued;
  }

  reset(): void {
    this.keys.clear();
    this.externalMoveX = 0;
    this.externalMoveY = 0;
    this.externalFire = false;
    this.mouseFire = false;
    this.dashQueued = false;
  }

  dispose(): void {
    for (const off of this.listeners) off();
    this.reset();
  }
}
