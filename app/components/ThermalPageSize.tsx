"use client";

import { useEffect } from "react";

const PX_PER_MM = 96 / 25.4;
const PAGE_MARGIN_MM = 3;

// Browsers reject `@page { size: 80mm auto }`, so a thermal receipt printed
// with it falls back to A4 and leaves a blank tail. Instead we measure the real
// receipt height and write an explicit `@page { size: <width>mm <height>mm }`,
// re-measuring right before printing in case the content reflowed.
//
// Render this next to a receipt element with id="thermal-receipt".
export function ThermalPageSize({ widthMm }: { widthMm: number }) {
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-thermal-page", "");
    document.head.appendChild(style);

    const apply = () => {
      const el = document.getElementById("thermal-receipt");
      if (!el) return;
      // Measure at the width it will actually print at (paper minus margins) so
      // line wrapping — and therefore height — matches the printed result.
      const printWidthMm = widthMm - PAGE_MARGIN_MM * 2;
      const prevWidth = el.style.width;
      const prevMax = el.style.maxWidth;
      el.style.width = `${printWidthMm}mm`;
      el.style.maxWidth = "none";
      const heightMm = el.getBoundingClientRect().height / PX_PER_MM;
      el.style.width = prevWidth;
      el.style.maxWidth = prevMax;
      // +2mm of slack so rounding never spills a few pixels onto a second page.
      const pageHeightMm = Math.ceil(heightMm + PAGE_MARGIN_MM * 2 + 2);
      style.textContent = `@page { size: ${widthMm}mm ${pageHeightMm}mm; margin: ${PAGE_MARGIN_MM}mm; }`;
    };

    apply();
    // Fonts / images can change the height after first paint.
    const raf = requestAnimationFrame(apply);
    document.fonts?.ready.then(apply).catch(() => {});
    window.addEventListener("beforeprint", apply);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("beforeprint", apply);
      style.remove();
    };
  }, [widthMm]);

  return null;
}
