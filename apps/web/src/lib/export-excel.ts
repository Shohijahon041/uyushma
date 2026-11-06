/**
 * Zero-dependency Excel / CSV eksport utiliti.
 * UTF-8 BOM (\uFEFF) qo'shilgan holda Microsoft Excel dasturida o'zbekcha harflar (o', g', sh, ch)
 * va raqamlar buzilmasdan, toza ustunlarda ochiladi.
 */

export function exportToCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  if (typeof window === "undefined") return;

  const escapeCell = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const headerRow = headers.map(escapeCell).join(";");
  const dataRows = rows.map((row) => row.map(escapeCell).join(";")).join("\r\n");

  // UTF-8 BOM + CSV (nuqtali vergul ajratgich bilan Excel ustunlarga avtomatik ajratadi)
  const csvContent = `\uFEFF${headerRow}\r\n${dataRows}`;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename.endsWith(".csv") ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Excel HTML jadval formati (.xls sifatida).
 * Excel ochilganda stil, fon rangi va to'liq jadval ko'rinishida taqdim etiladi.
 */
export function exportToExcelTable(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  if (typeof window === "undefined") return;

  const headerHtml = headers
    .map(
      (h) =>
        `<th style="background-color: #1e3a8a; color: #ffffff; font-weight: bold; padding: 10px; border: 1px solid #cbd5e1;">${escapeHtml(h)}</th>`,
    )
    .join("");

  const rowsHtml = rows
    .map((row, idx) => {
      const bg = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
      const cells = row
        .map(
          (val) =>
            `<td style="padding: 8px; border: 1px solid #cbd5e1; mso-number-format:'\\@';">${escapeHtml(val ?? "")}</td>`,
        )
        .join("");
      return `<tr style="background-color: ${bg};">${cells}</tr>`;
    })
    .join("");

  const template = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <!--[if gte mso 9]>
      <xml>
        <x:ExcelWorkbook>
          <x:ExcelWorksheets>
            <x:ExcelWorksheet>
              <x:Name>${escapeHtml(sheetName)}</x:Name>
              <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
            </x:ExcelWorksheet>
          </x:ExcelWorksheets>
        </x:ExcelWorkbook>
      </xml>
      <![endif]-->
      <meta http-equiv="content-type" content="text/plain; charset=UTF-8"/>
      <style>
        body { font-family: Calibri, sans-serif; }
        table { border-collapse: collapse; width: 100%; }
      </style>
    </head>
    <body>
      <table>
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </body>
    </html>
  `;

  const blob = new Blob([`\uFEFF${template}`], {
    type: "application/vnd.ms-excel;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename.endsWith(".xls") ? filename : `${filename}.xls`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeHtml(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

