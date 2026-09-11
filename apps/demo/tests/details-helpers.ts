import type { Page } from "playwright/test";

export async function expandDetails(page: Page, testId: string): Promise<void> {
  const details = page.getByTestId(testId);
  if (!(await details.evaluate((element: HTMLDetailsElement) => element.open))) {
    await details.locator("summary").click();
  }
}
