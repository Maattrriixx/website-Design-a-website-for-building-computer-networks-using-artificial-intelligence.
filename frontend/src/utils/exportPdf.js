import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── Brand palette — change these to re-skin the whole report ──────────────
const COLORS = {
  headerBg: [15, 23, 42],       // dark slate — header banner + table head
  headerText: [255, 255, 255],
  accent: [34, 197, 94],        // brand green (#22c55e) — accent bar / highlights
  rowAlt: [246, 248, 247],      // faint alternating row tint
  border: [230, 232, 235],      // hairline row separators
  textPrimary: [30, 32, 38],
  textMuted: [120, 126, 135],
};

const DEVICES_PER_COLUMN_THRESHOLD = 4; // switch to 2 columns above this many devices

/**
 * Builds and downloads a PDF report: one big table, one row per room.
 * @param {{ project_name?: string, rooms: Array }} data - response from
 *   GET /projects/{project}/rooms-devices
 */
export function exportRoomsPdf(data) {
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
  const title = data?.project_name || 'Network Design Report';
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // ─── Header banner ─────────────────────────────────────────────────────
  const bannerH = 64;
  doc.setFillColor(...COLORS.headerBg);
  doc.rect(0, 0, pageWidth, bannerH, 'F');
  doc.setFillColor(...COLORS.accent);
  doc.rect(0, bannerH - 3, pageWidth, 3, 'F'); // accent underline

  doc.setTextColor(...COLORS.headerText);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`Project name: ${title}`, 32, 32);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 205, 212);
  const generatedOn = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.text(`${rooms.length} rooms  •  Generated ${generatedOn}`, 32, 48);

  // ─── Build rows, precomputing each device list split into 2 columns ────
  const rows = rooms.filter(Boolean).map((room, idx) => {
    const devices = Array.isArray(room.devices) ? room.devices : [];
    return {
      cells: [idx + 1, room.room_type || '—', room.area != null ? room.area.toFixed(2) : '—', ''],
      devices,
    };
  });

  autoTable(doc, {
    startY: bannerH + 24,
    margin: { left: 32, right: 32, bottom: 40 },
    head: [['No.', 'Type', 'Area (m²)', 'Devices']],
    body: rows.map((r) => r.cells),
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: { top: 10, bottom: 10, left: 10, right: 10 },
      valign: 'top',
      textColor: COLORS.textPrimary,
      lineColor: COLORS.border,
      lineWidth: { bottom: 0.75, top: 0, left: 0, right: 0 },
    },
    headStyles: {
      fillColor: COLORS.headerBg,
      textColor: COLORS.headerText,
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: { top: 10, bottom: 10, left: 10, right: 10 },
      lineWidth: 0,
    },
    alternateRowStyles: { fillColor: COLORS.rowAlt },
    columnStyles: {
      0: { cellWidth: 55, fontStyle: 'bold', valign: 'middle' },
      1: { cellWidth: 130, textColor: COLORS.textMuted, valign: 'middle' },
      2: { cellWidth: 90, valign: 'middle', halign: 'center' },
      3: { cellWidth: 'auto' },
    },
    // Reserve enough row height for the 2-column device layout, and blank
    // out the default cell text for column 3 — we draw it ourselves below.
    didParseCell: (hook) => {
      if (hook.section !== 'body' || hook.column.index !== 3) return;
      const devices = rows[hook.row.index]?.devices ?? [];
      const rowsNeeded = devices.length ? Math.ceil(devices.length / (devices.length > DEVICES_PER_COLUMN_THRESHOLD ? 2 : 1)) : 1;
      const lineHeight = 12;
      hook.cell.styles.minCellHeight = rowsNeeded * lineHeight + 20;
      hook.cell.text = [];
    },
    didDrawCell: (hook) => {
      if (hook.section !== 'body' || hook.column.index !== 3) return;
      const devices = rows[hook.row.index]?.devices ?? [];
      const { x, y, width, height } = hook.cell;
      doc.setFontSize(9);
      doc.setTextColor(...COLORS.textPrimary);

      if (!devices.length) {
        doc.setTextColor(...COLORS.textMuted);
        doc.text('—', x + 10, y + height / 2 + 3);
        return;
      }

      const twoCol = devices.length > DEVICES_PER_COLUMN_THRESHOLD;
      const colWidth = twoCol ? width / 2 : width;
      const lineHeight = 12;
      const startY = y + 14;

      devices.forEach((d, i) => {
        const col = twoCol ? Math.floor(i / Math.ceil(devices.length / 2)) : 0;
        const row = twoCol ? i % Math.ceil(devices.length / 2) : i;
        const cx = x + 10 + col * colWidth;
        const cy = startY + row * lineHeight;
        // small accent dot before each device
        doc.setFillColor(...COLORS.accent);
        doc.circle(cx, cy - 3, 1.6, 'F');
        doc.setTextColor(...COLORS.textPrimary);
        doc.text(`${d.type}: ${d.quantity}`, cx + 6, cy);
      });
    },
    didDrawPage: () => {
      const pageCount = doc.internal.getNumberOfPages();
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(...COLORS.textMuted);
      doc.text(
        `Page ${doc.internal.getCurrentPageInfo().pageNumber} of ${pageCount}`,
        pageWidth - 32,
        pageH - 18,
        { align: 'right' },
      );
      doc.text(title, 32, pageH - 18);
    },
  });

  const fileName = `${title.replace(/[^\w\-]+/g, '_')}.pdf`;
  doc.save(fileName);
}
