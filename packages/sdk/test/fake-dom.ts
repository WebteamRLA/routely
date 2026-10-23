/**
 * Just enough of an Element for the SDK's DOM code, so its tests keep running in plain Node
 * like every other suite here — no jsdom dependency in a zero-dependency package.
 */
export class FakeElement {
  tagName: string;
  textContent: string | null = "";
  value = "";
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  private attrs = new Map<string, string>();
  private props = new Map<string, { value: string; priority: string }>();

  style = {
    setProperty: (name: string, value: string, priority = "") => {
      this.props.set(name, { value, priority });
    },
    getPropertyValue: (name: string) => this.props.get(name)?.value ?? "",
    getPropertyPriority: (name: string) => this.props.get(name)?.priority ?? "",
    removeProperty: (name: string) => void this.props.delete(name),
  };

  constructor(tag: string, attrs: Record<string, string> = {}) {
    this.tagName = tag.toUpperCase();
    for (const [key, value] of Object.entries(attrs)) this.attrs.set(key, value);
  }

  append(...children: FakeElement[]): this {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
    return this;
  }

  remove(): void {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children = parent.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  private descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  querySelector(tag: string): FakeElement | null {
    return this.descendants().find((el) => el.tagName === tag.toUpperCase()) ?? null;
  }
  querySelectorAll(tag: string): FakeElement[] {
    return this.descendants().filter((el) => el.tagName === tag.toUpperCase());
  }
}

/** Casts a fake to the DOM type the module under test expects. */
export const asElement = (el: FakeElement) => el as unknown as Element;
