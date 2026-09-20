// tests/e2e/declarations.d.ts
declare module '@playwright/test' {
  export interface Locator {
    first(): Locator;
    last(): Locator;
    nth(index: number): Locator;
    isVisible(): Promise<boolean>;
    isEnabled(): Promise<boolean>;
    click(options?: { position?: { x: number; y: number }; force?: boolean }): Promise<void>;
    dblclick(): Promise<void>;
    fill(value: string): Promise<void>;
  }

  export interface Page {
    goto(url: string, options?: Record<string, any>): Promise<any>;
    locator(selector: string): Locator;
    keyboard: {
      press(key: string): Promise<void>;
      type(text: string): Promise<void>;
    };
    evaluate(fn: Function, arg?: any): Promise<any>;
  }

  export interface ExpectMatcher {
    toBeVisible(): Promise<void>;
    toBeEnabled(): Promise<void>;
    toHaveTitle(title: string | RegExp): Promise<void>;
    toHaveURL(url: string | RegExp): Promise<void>;
    toBeDefined(): Promise<void>;
    toContainText(text: string): Promise<void>;
  }

  export interface Expect {
    (actual: any): ExpectMatcher;
  }

  export const expect: Expect;

  export type TestFunction = (args: { page: Page }, testInfo?: any) => Promise<void> | void;

  export interface Test {
    (name: string, fn: TestFunction): void;
    describe(name: string, fn: () => void): void;
    beforeEach(fn: TestFunction): void;
    afterEach(fn: TestFunction): void;
    skip(name: string, fn: TestFunction): void;
    only(name: string, fn: TestFunction): void;
    use(options: any): void;
  }

  export const test: Test;
  export function defineConfig(config: any): any;
  export const devices: Record<string, any>;
}
