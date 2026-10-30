import { expect, test } from "@playwright/test";

// PHASES Phase 2 항목 6: 데모 설계사 3명 × 화면 1~3(설계사 선택 · 월별 명세(+라인 상세) · 한도 현황(+상세)).
// 캡처는 docs/evidence/captures/phase-2-*.png(증거 문서).
const CAPTURES = "../docs/evidence/captures";

for (const n of [1, 2, 3] as const) {
  test(`데모 설계사 ${n}: 선택 → 명세 → 라인 상세 → 한도 → 한도 상세`, async ({ page }) => {
    // 화면 1
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "데모 설계사 선택" })).toBeVisible();
    await expect(page.locator("[data-testid^=demo-agent-]")).toHaveCount(3);
    await expect(page.getByTestId("chip-data")).toHaveText(/^기준 데이터 \d{2}-\d{2} 생성$/);
    if (n === 1) await page.screenshot({ path: `${CAPTURES}/phase-2-screen1-select.png`, fullPage: true });
    await page.getByTestId(`demo-agent-${n}`).click();

    // 화면 2: 마지막 달 명세
    await expect(page).toHaveURL(/\/me\/earnings\/\d{6}$/);
    await expect(page.getByTestId("chip-data")).toContainText(`데모 설계사 ${n}`);
    const card = page.getByTestId("month-card");
    await expect(card).toBeVisible();
    await expect(card.locator(".tag").first()).toHaveText(/^(예상|확정|확정\(세후 예상\)|지급완료)$/);
    await expect(page.getByTestId("lines").getByTestId("line-link").first()).toBeVisible();
    await expect(page.locator("footer")).toHaveText("가상 데모 데이터 · 설계사 참고용 · 비확정 · 고객 제시 불가");
    await page.screenshot({ path: `${CAPTURES}/phase-2-demo${n}-screen2-statement.png`, fullPage: true });

    // 월 바꾸기 → 다른 달 명세
    const select = page.getByTestId("month-select");
    const options = await select.locator("option").allInnerTexts();
    expect(options.length).toBeGreaterThan(1);
    const second = await select.locator("option").nth(1).getAttribute("value");
    await select.selectOption(second!);
    await expect(page).toHaveURL(new RegExp(`/me/earnings/${second}$`));
    await expect(page.getByTestId("month-card")).toContainText(`${second!.slice(0, 4)}년`);

    // 라인 상세
    await page.getByTestId("line-link").first().click();
    await expect(page).toHaveURL(/\/me\/earnings\/lines\//);
    await expect(page.getByTestId("line-detail")).toBeVisible();
    await expect(page.getByText("설명 없음")).toBeAttached();
    await expect(page.locator("body")).not.toContainText(/POL-\d{4}-\d+\s/); // 화면 본문에 증권번호 원문 없음(가린 값만)

    // 화면 3: 한도 현황 → 상세
    await page.getByRole("link", { name: "한도", exact: true }).click();
    await expect(page).toHaveURL(/\/me\/limits$/);
    const ledgers = page.getByTestId("ledger-card");
    await expect(ledgers.first()).toBeVisible();
    await expect(ledgers.first().getByRole("img")).toHaveAttribute("aria-label", /^소진율 -?\d+\.\d%$/);
    await page.screenshot({ path: `${CAPTURES}/phase-2-demo${n}-screen3-limits.png`, fullPage: true });
    await ledgers.first().click();
    await expect(page).toHaveURL(/\/me\/limits\/.+/);
    await expect(page.getByTestId("limit-detail")).toContainText("배 → 한도");
    await expect(page.getByTestId("limit-history").locator("li").first()).toBeVisible();
  });
}

test("데모 1: A-1 원장 타임라인이 누적 1,800,000원(한도 100%)에 닿는다 — 카드는 해약 뒤 현재 값", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("demo-agent-1").click();
  await expect(page).toHaveURL(/\/me\/earnings\/\d{6}$/);
  await page.getByRole("link", { name: "한도", exact: true }).click();
  await page.locator('a[href="/me/limits/1"]').click();
  await expect(page.getByTestId("limit-detail")).toContainText("한도 1,800,000원");
  await expect(page.getByTestId("limit-history")).toContainText("누적 1,800,000원");
  await page.screenshot({ path: "../docs/evidence/captures/phase-2-demo1-a1-ledger.png", fullPage: true });
});

test("세션 없이 설계사 화면에 오면 설계사 선택으로(401)", async ({ page }) => {
  await page.goto("/me/limits");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "데모 설계사 선택" })).toBeVisible();
});
