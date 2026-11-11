"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiRequest } from "@/lib/client-api";
import { formatDate, useApi } from "@/lib/use-api";
import type { DriverItem, RouteItem, Vehicle, WaybillItem, WaybillStats } from "@/lib/types";
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { formatUzPlate } from "@/lib/plate";
import { formatUzPhone } from "@/lib/phone";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowTimeString(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

export default function WaybillsPage() {
  const t = useTranslations("waybills");
  const tc = useTranslations("common");

  // Filter States
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dateFilter, setDateFilter] = useState<string>("");

  // Data Fetching
  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (dateFilter) params.set("date", dateFilter);
    if (search.trim()) params.set("q", search.trim());
    const qs = params.toString();
    return qs ? `/waybills?${qs}` : "/waybills";
  }, [statusFilter, dateFilter, search]);

  const { data, loading, error, reload } = useApi<{ items: WaybillItem[]; total: number }>(queryUrl);
  const statsApi = useApi<WaybillStats>("/waybills/stats");
  const driversApi = useApi<{ items: DriverItem[] }>("/drivers?limit=200");
  const vehiclesApi = useApi<{ items: Vehicle[] }>("/vehicles?limit=200");
  const routesApi = useApi<{ items: RouteItem[] }>("/routes?limit=200");

  // Create Modal State
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [formNumber, setFormNumber] = useState("");
  const [formDate, setFormDate] = useState(today());
  const [formValidUntil, setFormValidUntil] = useState(today());
  const [formDepartureTime, setFormDepartureTime] = useState(nowTimeString());
  const [formDriverId, setFormDriverId] = useState("");
  const [formVehicleId, setFormVehicleId] = useState("");
  const [formRouteId, setFormRouteId] = useState("");
  const [formMedicalPassed, setFormMedicalPassed] = useState(true);
  const [formDoctorName, setFormDoctorName] = useState("");
  const [formTechnicalPassed, setFormTechnicalPassed] = useState(true);
  const [formMechanicName, setFormMechanicName] = useState("");
  const [formSpecialNotes, setFormSpecialNotes] = useState("");
  const [formAssignDriver, setFormAssignDriver] = useState<boolean>(true);

  // Filters for Vehicle and Driver search in modal
  const [driverFilter, setDriverFilter] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");

  const filteredVehicles = useMemo(() => {
    const q = vehicleFilter.trim().toLowerCase();
    const items = vehiclesApi.data?.items ?? [];
    if (!q) return items;
    return items.filter(
      (v) =>
        v.plateNumber.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        (v.owner?.fullName && v.owner.fullName.toLowerCase().includes(q))
    );
  }, [vehiclesApi.data?.items, vehicleFilter]);

  const filteredDrivers = useMemo(() => {
    const q = driverFilter.trim().toLowerCase();
    const items = driversApi.data?.items ?? [];
    if (!q) return items;
    return items.filter(
      (d) =>
        d.fullName.toLowerCase().includes(q) ||
        (d.phone && d.phone.toLowerCase().includes(q))
    );
  }, [driversApi.data?.items, driverFilter]);

  // Close Waybill Modal State
  const [closeTarget, setCloseTarget] = useState<WaybillItem | null>(null);
  const [closeOdometer, setCloseOdometer] = useState<string>("");
  const [closeReturnTime, setCloseReturnTime] = useState<string>(nowTimeString());
  const [closeFuelAfter, setCloseFuelAfter] = useState<string>("");
  const [closeNotes, setCloseNotes] = useState<string>("");
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Print / View Waybill Modal State
  const [printTarget, setPrintTarget] = useState<WaybillItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // When opening Create Modal, prefetch next number
  async function handleOpenCreate() {
    setFormError(null);
    setFormDate(today());
    setFormValidUntil(today());
    setFormDepartureTime(nowTimeString());
    setFormAssignDriver(true);
    setDriverFilter("");
    setVehicleFilter("");
    try {
      const res = await apiRequest<{ nextNumber: string }>("/waybills/next-number");
      setFormNumber(res.nextNumber);
    } catch {
      setFormNumber("");
    }

    if (driversApi.data?.items[0] && !formDriverId) {
      setFormDriverId(driversApi.data.items[0].id);
    }
    if (vehiclesApi.data?.items[0] && !formVehicleId) {
      setFormVehicleId(vehiclesApi.data.items[0].id);
    }
    setCreateOpen(true);
  }

  // When Vehicle is selected, automatically select driver if assigned
  function handleSelectVehicle(vehId: string) {
    setFormVehicleId(vehId);
    const found = vehiclesApi.data?.items.find((v) => v.id === vehId);
    if (found) {
      if (found.routeId && !formRouteId) {
        setFormRouteId(found.routeId);
      }
      const driverAssigned = found.assignments?.[0]?.driver?.id;
      if (driverAssigned) {
        setFormDriverId(driverAssigned);
      }
    }
  }

  // When Driver is selected, if vehicle isn't chosen, find driver's vehicle
  function handleSelectDriver(driverId: string) {
    setFormDriverId(driverId);
    if (!formVehicleId) {
      const matchVehicle = vehiclesApi.data?.items.find(
        (v) => v.assignments?.[0]?.driver?.id === driverId
      );
      if (matchVehicle) {
        setFormVehicleId(matchVehicle.id);
        if (matchVehicle.routeId && !formRouteId) {
          setFormRouteId(matchVehicle.routeId);
        }
      }
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!formDriverId || !formVehicleId) {
      setFormError("Haydovchi va avtomobilni tanlash majburiy");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const departureDateTime = new Date(`${formDate}T${formDepartureTime || "08:00"}:00`).toISOString();
      await apiRequest("/waybills", {
        method: "POST",
        body: {
          number: formNumber.trim() || undefined,
          date: formDate,
          validUntil: formValidUntil || formDate,
          driverId: formDriverId,
          vehicleId: formVehicleId,
          routeId: formRouteId || undefined,
          assignDriver: formAssignDriver,
          departureTime: departureDateTime,
          medicalPassed: formMedicalPassed,
          medicalDoctorName: formDoctorName.trim() || undefined,
          technicalPassed: formTechnicalPassed,
          mechanicName: formMechanicName.trim() || undefined,
          specialNotes: formSpecialNotes.trim() || undefined,
        },
      });
      setCreateOpen(false);
      await Promise.all([reload(), statsApi.reload()]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setSaving(false);
    }
  }

  // Handle Closing Waybill
  function openCloseModal(waybill: WaybillItem) {
    setCloseTarget(waybill);
    setCloseOdometer(waybill.startOdometer ? String(waybill.startOdometer + 50) : "");
    setCloseReturnTime(nowTimeString());
    setCloseFuelAfter(waybill.fuelBefore ?? "");
    setCloseNotes("");
    setCloseError(null);
  }

  async function handleCloseWaybill(e: FormEvent) {
    e.preventDefault();
    if (!closeTarget) return;
    const endKm = closeOdometer ? parseInt(closeOdometer, 10) : undefined;
    if (endKm !== undefined && (isNaN(endKm) || endKm < 0)) {
      setCloseError("Qaytishdagi spidometr ko'rsatkichini to'g'ri kiriting");
      return;
    }

    setClosing(true);
    setCloseError(null);
    try {
      const returnDateTime = new Date(`${today()}T${closeReturnTime || "18:00"}:00`).toISOString();
      await apiRequest(`/waybills/${closeTarget.id}/close`, {
        method: "POST",
        body: {
          endOdometer: endKm,
          returnTime: returnDateTime,
          fuelAfter: closeFuelAfter ? parseFloat(closeFuelAfter) : undefined,
          specialNotes: closeNotes.trim() || undefined,
        },
      });
      setCloseTarget(null);
      await Promise.all([reload(), statsApi.reload()]);
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : tc("error"));
    } finally {
      setClosing(false);
    }
  }

  // Handle Cancel
  async function handleCancelWaybill(waybill: WaybillItem) {
    const reason = window.prompt("Ushbu yo'l varaqasini bekor qilish sababini kiriting:");
    if (reason === null) return;
    try {
      await apiRequest(`/waybills/${waybill.id}/cancel`, {
        method: "POST",
        body: { reason: reason.trim() || "Dispetcher tomonidan bekor qilindi" },
      });
      await Promise.all([reload(), statsApi.reload()]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tc("error"));
    }
  }

  // Pure standalone A4 Printable HTML generator (Guaranteed strict 1 single page)
  function escapeHtml(str: string | null | undefined): string {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function generatePrintableWaybillHtml(target: WaybillItem): string {
    const number = escapeHtml(target.number);
    const companyName = escapeHtml(target.company?.name ?? "Transport Korxonasi");
    const dateStr = escapeHtml(target.date ? target.date.slice(0, 10) : "");
    const validUntilStr = escapeHtml(target.validUntil ? target.validUntil.slice(0, 10) : "");
    const vehicleModel = escapeHtml(target.vehicle.model);
    const plateNumber = escapeHtml(formatUzPlate(target.vehicle.plateNumber));
    const ownerName = escapeHtml(target.vehicle.owner?.fullName ?? target.company?.name ?? "Transport Korxonasi");
    const ownerPhone = target.vehicle.owner?.phone ? `(${escapeHtml(formatUzPhone(target.vehicle.owner.phone))})` : "";
    const driverName = escapeHtml(target.driver.fullName);
    const driverPhone = escapeHtml(formatUzPhone(target.driver.phone));
    const driverLicense = escapeHtml(target.driver.licenseNumber ?? "Mavjud");
    const routeName = escapeHtml(
      target.route
        ? `${target.route.name} (${target.route.origin} → ${target.route.destination})`
        : "Erkin yo'nalish (shahar bo'ylab)"
    );
    const depTime = escapeHtml(
      target.departureTime
        ? new Date(target.departureTime).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })
        : "08:00"
    );
    const retTime = escapeHtml(
      target.returnTime
        ? new Date(target.returnTime).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })
        : "-"
    );
    const startOdo = target.startOdometer !== null ? `${target.startOdometer} km` : "-";
    const endOdo = target.endOdometer !== null ? `${target.endOdometer} km` : "-";
    const dist = target.distanceKm !== null ? `${target.distanceKm} km` : "-";
    const fuelType = escapeHtml(target.fuelType ?? "METAN");
    const fuelBefore = target.fuelBefore !== null ? `${target.fuelBefore}` : "-";
    const fuelAfter = target.fuelAfter !== null ? `${target.fuelAfter}` : "-";
    const fuelGiven = target.fuelGiven !== null ? `${target.fuelGiven}` : "0";
    const medDoctor = escapeHtml(target.medicalDoctorName ?? "Tibbiyot xodimi");
    const medTime = escapeHtml(
      target.medicalCheckedAt
        ? new Date(target.medicalCheckedAt).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })
        : (target.departureTime
            ? new Date(target.departureTime).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })
            : "07:45")
    );
    const techMechanic = escapeHtml(target.mechanicName ?? "Mas'ul mexanik");
    const techTime = escapeHtml(
      target.technicalCheckedAt
        ? new Date(target.technicalCheckedAt).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })
        : (target.departureTime
            ? new Date(target.departureTime).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })
            : "07:50")
    );
    const dispatcher = escapeHtml(target.dispatcherName ?? "Navbatchi dispetcher");
    const token = escapeHtml(target.publicToken);
    const qrUrl = `/api/proxy/waybills/public-verify/${token}/qr`;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Yo'l varaqasi № ${number}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 4mm 6mm !important;
  }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    color: #000000 !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 11px;
    line-height: 1.25;
    width: 100% !important;
    height: 100% !important;
    overflow: hidden !important;
  }
  .sheet {
    width: 100%;
    max-height: 278mm;
    margin: 0 auto;
    padding: 3mm 4mm;
    border: 1.5px solid #000000;
    page-break-after: avoid !important;
    break-after: avoid !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
    overflow: hidden !important;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
  }
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .box {
    border: 1px solid #000;
    border-radius: 4px;
    padding: 5px 6px;
    background: #fcfcfc;
  }
  .metrics-table {
    width: 100%;
    border-collapse: collapse;
    border: 1.5px solid #000;
    text-align: center;
    font-size: 10px;
  }
  .metrics-table th, .metrics-table td {
    border: 1px solid #000;
    padding: 3px 4px;
  }
  .metrics-table th {
    background: #f1f5f9;
    font-weight: bold;
  }
  .stamp-box {
    width: 88px;
    height: 48px;
    border: 1.5px dashed #000;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 2px;
    background: #ffffff;
    flex-shrink: 0;
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <div style="font-size: 8.5px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px; color: #475569;">
          O'zbekiston Respublikasi Transport Vazirligi
        </div>
        <div style="font-size: 14px; font-weight: 900; text-transform: uppercase; margin-top: 2px;">
          YO'L VARAQASI (ПУТЕВОЙ ЛИСТ)
        </div>
        <div style="font-family: monospace; font-size: 13px; font-weight: 900;">
          № ${number}
        </div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 9.5px; color: #475569;">Tashkilot (Tashuvchi):</div>
        <div style="font-size: 12px; font-weight: 900;">${companyName}</div>
        <div style="font-size: 9px; color: #475569; margin-top: 2px;">
          Sana: <b>${dateStr}</b> &bull; Amal qiladi: <b>${validUntilStr}</b>
        </div>
      </div>
    </div>

    <div class="grid-2 box" style="margin-top: 6px; font-size: 10px;">
      <div style="display: flex; flex-direction: column; gap: 3px;">
        <div>Avtomobil: <b>${vehicleModel}</b></div>
        <div>
          Davlat raqami:
          <span style="font-family: monospace; font-weight: 900; border: 1px solid #000; padding: 1px 4px; border-radius: 3px; background: #fff;">
            🇺🇿 ${plateNumber}
          </span>
        </div>
        <div>
          Transport haqiqiy egasi (mulkdor):<br>
          <span style="font-weight: 900; text-decoration: underline;">${ownerName}</span>
          <span style="font-family: monospace; color: #475569; margin-left: 4px;">${ownerPhone}</span>
        </div>
        <div style="font-size: 9.5px;">
          Yo'nalish: <b>${routeName}</b>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 3px;">
        <div>
          Amaldagi haydovchi (boshqaruvchi):<br>
          <span style="font-weight: 900; text-decoration: underline;">${driverName}</span>
        </div>
        <div>Guvohnoma (Prava): <span style="font-family: monospace; font-weight: bold;">${driverLicense}</span></div>
        <div>Aloqa telefoni: <span style="font-family: monospace; font-weight: bold;">${driverPhone}</span></div>
        <div style="font-size: 9.5px; color: #166534;">Holati: <b>Transportga rasman biriktirilgan</b></div>
      </div>
    </div>

    <div class="box" style="margin-top: 6px; padding: 4px 8px; display: flex; justify-content: space-between; align-items: center; font-size: 10px;">
      <div>Amal qilish muddati: <b style="font-size: 11px; text-decoration: underline;">${dateStr} dan ${validUntilStr} gacha</b></div>
      <div>Chiqish vaqti: <b style="font-family: monospace;">${depTime}</b></div>
    </div>

    <div class="grid-2" style="margin-top: 6px;">
      <div class="box" style="display: flex; flex-direction: column; justify-content: space-between; padding: 5px 6px;">
        <div>
          <div style="font-size: 9.5px; font-weight: 900; text-transform: uppercase; text-align: center; border-bottom: 1px solid #000; padding-bottom: 2px;">
            Tibbiy Ko'rik (Safar oldi)
          </div>
          <div style="font-size: 8px; color: #334155; margin-top: 3px; line-height: 1.2;">
            Haydovchi safar oldi tibbiy ko'rigidan o'tkazildi. Spirtli ichimlik va giyohvand moddalar ta'siri aniqlanmadi.
          </div>
          <div style="font-size: 9px; margin-top: 3px; line-height: 1.3;">
            <div>Holati: <b style="color: ${target.medicalPassed ? "#166534" : "#b91c1c"};">
              ${target.medicalPassed ? "✅ Sog'lom / Ruxsat berildi" : "❌ Ruxsat berilmadi"}
            </b></div>
            <div>Shifokor: <b>${medDoctor}</b></div>
            <div>Vaqti: <b>${medTime}</b></div>
          </div>
        </div>
        <div style="border-top: 1px solid #cbd5e1; margin-top: 4px; padding-top: 3px; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 8.5px;">
            Shifokor imzosi:<br><span style="font-family: monospace;">____________</span>
          </div>
          <div class="stamp-box">
            <span style="font-size: 7.5px; font-weight: 900; text-transform: uppercase;">M.O'. / ПЕЧАТЬ</span>
            <span style="font-size: 7px; color: #475569;">(Tibbiy muhr)</span>
          </div>
        </div>
      </div>

      <div class="box" style="display: flex; flex-direction: column; justify-content: space-between; padding: 5px 6px;">
        <div>
          <div style="font-size: 9.5px; font-weight: 900; text-transform: uppercase; text-align: center; border-bottom: 1px solid #000; padding-bottom: 2px;">
            Texnik Ko'rik (Safar oldi)
          </div>
          <div style="font-size: 8px; color: #334155; margin-top: 3px; line-height: 1.2;">
            Avtomobilning tormoz, rul boshqaruvi, shinalar, chiroqlar va xavfsizlik tizimlari tekshirildi, texnik soz holatda.
          </div>
          <div style="font-size: 9px; margin-top: 3px; line-height: 1.3;">
            <div>Holati: <b style="color: ${target.technicalPassed ? "#166534" : "#b91c1c"};">
              ${target.technicalPassed ? "✅ Texnik soz / Ruxsat berildi" : "❌ Nosoz"}
            </b></div>
            <div>Mexanik: <b>${techMechanic}</b></div>
            <div>Vaqti: <b>${techTime}</b></div>
          </div>
        </div>
        <div style="border-top: 1px solid #cbd5e1; margin-top: 4px; padding-top: 3px; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 8.5px;">
            Mexanik imzosi:<br><span style="font-family: monospace;">____________</span>
          </div>
          <div class="stamp-box">
            <span style="font-size: 7.5px; font-weight: 900; text-transform: uppercase;">M.O'. / ПЕЧАТЬ</span>
            <span style="font-size: 7px; color: #475569;">(Texnik muhr)</span>
          </div>
        </div>
      </div>
    </div>

    <div style="border-top: 2px solid #000; margin-top: 6px; padding-top: 4px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
      <div style="font-size: 9px; line-height: 1.25; flex: 1;">
        <div style="font-size: 9.5px;">
          Mas&apos;ul shaxs imzosi: <span style="font-family: monospace;">_______________________</span>
        </div>
        <div style="font-size: 8px; color: #475569; margin-top: 2px;">
          Ushbu yo'l varaqasi transport vositasining qonuniy reysga chiqishiga asos bo'ladi. YPX (DYHXX) va Transport Nazorati inspektorlari o'ng tarafdagi QR kod orqali haqiqiylikni onlayn tekshirishi mumkin.
        </div>
        <div style="font-family: monospace; font-size: 7.5px; color: #64748b; margin-top: 2px;">
          Hujjat ID: ${token}
        </div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; flex-shrink: 0;">
        <div style="width: 54px; height: 54px; border: 1px solid #000; padding: 1px; background: #fff;">
          <img src="${qrUrl}" alt="QR" width="50" height="50" style="width: 50px; height: 50px; display: block;" />
        </div>
        <span style="font-size: 6.5px; font-weight: bold; text-transform: uppercase; margin-top: 1px; color: #334155;">YPX QR</span>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  function handlePrintWaybill(target: WaybillItem) {
    try {
      const existing = document.getElementById("waybill-print-frame");
      if (existing) existing.remove();

      const iframe = document.createElement("iframe");
      iframe.id = "waybill-print-frame";
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "none";
      iframe.style.opacity = "0";
      iframe.style.pointerEvents = "none";
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (!doc) {
        window.print();
        return;
      }

      const html = generatePrintableWaybillHtml(target);
      doc.open();
      doc.write(html);
      doc.close();

      const doPrint = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.print();
        }
      };

      setTimeout(doPrint, 250);
    } catch {
      window.print();
    }
  }

  const items = data?.items ?? [];
  const stats = statsApi.data ?? {
    total: 0,
    active: 0,
    completedToday: 0,
    compliantChecksRate: 100,
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <button
            type="button"
            onClick={handleOpenCreate}
            className="btn btn-primary flex items-center gap-2"
          >
            <span>+</span>
            <span>{t("newWaybill")}</span>
          </button>
        }
      />

      {actionError && (
        <Alert tone="error">
          <div className="flex items-center justify-between">
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-xs font-bold underline"
            >
              {tc("close")}
            </button>
          </div>
        </Alert>
      )}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            {t("total")}
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{stats.total}</div>
        </div>

        <div className="card p-4 border-l-4 border-l-emerald-500">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            {t("active")}
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-600">{stats.active}</div>
        </div>

        <div className="card p-4 border-l-4 border-l-blue-500">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            {t("completedToday")}
          </div>
          <div className="mt-2 text-2xl font-bold text-blue-600">{stats.completedToday}</div>
        </div>

        <div className="card p-4 border-l-4 border-l-violet-500">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            {t("compliantRate")}
          </div>
          <div className="mt-2 text-2xl font-bold text-violet-600">
            {stats.compliantChecksRate}%
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="card p-4 flex flex-col sm:flex-row items-center gap-3">
        <div className="flex-1 w-full">
          <input
            type="text"
            className="input w-full"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="w-full sm:w-48">
          <select
            className="input w-full"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">{t("allStatuses")}</option>
            <option value="ACTIVE">{t("statusActive")}</option>
            <option value="ISSUED">{t("statusIssued")}</option>
            <option value="COMPLETED">{t("statusCompleted")}</option>
            <option value="CANCELLED">{t("statusCancelled")}</option>
          </select>
        </div>

        <div className="w-full sm:w-44">
          <input
            type="date"
            className="input w-full"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
        </div>

        {dateFilter && (
          <button
            type="button"
            onClick={() => setDateFilter("")}
            className="text-xs text-slate-500 hover:text-slate-800 underline whitespace-nowrap"
          >
            Sanani tozalash
          </button>
        )}
      </div>

      {/* Waybills Table */}
      {loading ? (
        <Loading />
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState>
          <div className="text-base font-semibold text-slate-700">{t("empty")}</div>
          <p className="mt-1 text-slate-500 max-w-sm mx-auto">
            Hozircha hech qanday yo&apos;l varaqasi topilmadi. Yangi yo&apos;l varaqasini rasmiylashtirish uchun yuqoridagi tugmani bosing.
          </p>
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t("number")}</th>
                <th>{t("driver")}</th>
                <th>{t("vehicle")}</th>
                <th>{t("route")}</th>
                <th>Amal qilish muddati</th>
                <th>{t("checks")}</th>
                <th>{t("status")}</th>
                <th className="text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((waybill) => {
                const isWaybillActive = waybill.status === "ACTIVE" || waybill.status === "ISSUED";
                return (
                  <tr key={waybill.id} className="hover:bg-slate-50/60 transition-colors">
                    {/* Number */}
                    <td>
                      <div className="font-mono font-bold text-slate-900 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        {waybill.number}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {waybill.date ? waybill.date.slice(0, 10) : ""}
                      </div>
                    </td>

                    {/* Driver */}
                    <td>
                      <div className="font-semibold text-slate-900">
                        {waybill.driver.fullName}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {formatUzPhone(waybill.driver.phone)}
                      </div>
                      <div className="text-[10px] text-emerald-700 font-medium">
                        Amaldagi boshqaruvchi
                      </div>
                    </td>

                    {/* Vehicle */}
                    <td>
                      <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono font-bold text-xs text-slate-800">
                        {formatUzPlate(waybill.vehicle.plateNumber)}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {waybill.vehicle.model}
                      </div>
                      {waybill.vehicle.owner && (
                        <div className="text-[11px] text-slate-600 mt-0.5">
                          Egasi: <span className="font-semibold text-slate-800">{waybill.vehicle.owner.fullName}</span>
                        </div>
                      )}
                    </td>

                    {/* Route */}
                    <td>
                      <div className="text-sm font-medium text-slate-800">
                        {waybill.route ? waybill.route.name : "Erkin yo'nalish"}
                      </div>
                      {waybill.route?.distanceKm && (
                        <div className="text-xs text-slate-400">
                          {waybill.route.distanceKm} km
                        </div>
                      )}
                    </td>

                    {/* Date and Time / Validity range */}
                    <td className="text-xs">
                      <div className="font-semibold text-slate-900">
                        {waybill.date ? waybill.date.slice(0, 10) : ""}
                      </div>
                      {waybill.validUntil && waybill.validUntil !== waybill.date && (
                        <div className="text-[11px] text-emerald-700 font-medium">
                          → {waybill.validUntil.slice(0, 10)} gacha
                        </div>
                      )}
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Chiqish:{" "}
                        <span className="font-semibold">
                          {waybill.departureTime
                            ? new Date(waybill.departureTime).toLocaleTimeString("uz-UZ", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "-"}
                        </span>
                      </div>
                    </td>

                    {/* Inspections */}
                    <td>
                      <div className="flex flex-col gap-1">
                        <span
                          className={`badge text-[10px] ${
                            waybill.medicalPassed
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {waybill.medicalPassed ? "🩺 Shifokor: OK" : "🩺 Shifokor: Rad"}
                        </span>
                        <span
                          className={`badge text-[10px] ${
                            waybill.technicalPassed
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {waybill.technicalPassed ? "🔧 Mexanik: OK" : "🔧 Mexanik: Rad"}
                        </span>
                      </div>
                    </td>



                    {/* Status */}
                    <td>
                      <StatusBadge
                        status={waybill.status}
                        label={
                          waybill.status === "ACTIVE"
                            ? t("statusActive")
                            : waybill.status === "ISSUED"
                              ? t("statusIssued")
                              : waybill.status === "COMPLETED"
                                ? t("statusCompleted")
                                : t("statusCancelled")
                        }
                      />
                    </td>

                    {/* Actions */}
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Print / View */}
                        <button
                          type="button"
                          onClick={() => setPrintTarget(waybill)}
                          title="Ko'rish va chop etish"
                          className="px-2.5 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
                        >
                          👁️ Ko&apos;rish
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePrintWaybill(waybill)}
                          title="Qat'iy 1 ta varaqda darhol chop etish"
                          className="px-2.5 py-1 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition flex items-center gap-1 shadow-sm"
                        >
                          🖨️ Chop etish
                        </button>

                        {/* Complete / Close */}
                        {isWaybillActive && (
                          <button
                            type="button"
                            onClick={() => openCloseModal(waybill)}
                            title={t("close")}
                            className="px-2.5 py-1 text-xs font-semibold bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition"
                          >
                            🏁 Yakunlash
                          </button>
                        )}

                        {/* Cancel */}
                        {isWaybillActive && (
                          <button
                            type="button"
                            onClick={() => handleCancelWaybill(waybill)}
                            title={t("cancel")}
                            className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded-lg transition"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: YANGI YO'L VARAQASI RASMIYLASHTIRISH                         */}
      {/* ===================================================================== */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-5 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{t("createTitle")}</h3>
                <p className="text-xs text-slate-500">
                  Haydovchi, avtomobil va ko&apos;rik xulosalarini kiriting
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            {formError && <Alert tone="error">{formError}</Alert>}

            <form onSubmit={handleCreate} className="space-y-4">
              {/* Row 1: Number, Date Range (Kundan Kungacha), and Departure Time */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Yo&apos;l varaqasi raqami
                  </label>
                  <input
                    type="text"
                    required
                    className="input w-full font-mono font-bold"
                    value={formNumber}
                    onChange={(e) => setFormNumber(e.target.value)}
                    placeholder="PV-26-0001"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Boshlanish sanasi (Kundan)
                  </label>
                  <input
                    type="date"
                    required
                    className="input w-full"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tugash sanasi (Kungacha)
                  </label>
                  <input
                    type="date"
                    required
                    className="input w-full"
                    value={formValidUntil}
                    onChange={(e) => setFormValidUntil(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("departureTime")}
                  </label>
                  <input
                    type="time"
                    required
                    className="input w-full"
                    value={formDepartureTime}
                    onChange={(e) => setFormDepartureTime(e.target.value)}
                  />
                </div>
              </div>

              {/* Row 2: Vehicle & Driver Selection with Instant Search Filters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("selectVehicle")} *
                  </label>
                  <input
                    type="text"
                    placeholder="🔍 Avtomobilni qidirish (davlat raqami yoki model)..."
                    className="input text-xs mb-1.5 w-full bg-slate-50 focus:bg-white"
                    value={vehicleFilter}
                    onChange={(e) => setVehicleFilter(e.target.value)}
                  />
                  <select
                    required
                    className="input w-full"
                    value={formVehicleId}
                    onChange={(e) => handleSelectVehicle(e.target.value)}
                  >
                    <option value="">Tanlang...</option>
                    {filteredVehicles.map((veh) => (
                      <option key={veh.id} value={veh.id}>
                        {formatUzPlate(veh.plateNumber)} — {veh.model} {veh.owner?.fullName ? `· Egasi: ${veh.owner.fullName}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("selectDriver")} *
                  </label>
                  <input
                    type="text"
                    placeholder="🔍 Haydovchini qidirish (F.I.Sh yoki telefon)..."
                    className="input text-xs mb-1.5 w-full bg-slate-50 focus:bg-white"
                    value={driverFilter}
                    onChange={(e) => setDriverFilter(e.target.value)}
                  />
                  <select
                    required
                    className="input w-full"
                    value={formDriverId}
                    onChange={(e) => handleSelectDriver(e.target.value)}
                  >
                    <option value="">Tanlang...</option>
                    {filteredDrivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.fullName} ({formatUzPhone(d.phone)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Transport haqiqiy egasi va amaldagi haydovchi info kartasi */}
              {formVehicleId && (
                <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 text-xs space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 block text-[11px]">Transport haqiqiy egasi (mulkdor):</span>
                      <span className="font-bold text-slate-900">
                        {vehiclesApi.data?.items.find((v) => v.id === formVehicleId)?.owner?.fullName ?? "Aniqlanmagan"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">Avtomobilga biriktirilgan haydovchi:</span>
                      <span className="font-bold text-slate-900">
                        {vehiclesApi.data?.items.find((v) => v.id === formVehicleId)?.assignments?.[0]?.driver?.fullName ?? (
                          <span className="text-amber-700 italic">Hozircha biriktirilmagan</span>
                        )}
                      </span>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 pt-1 border-t border-emerald-200/60 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formAssignDriver}
                      onChange={(e) => setFormAssignDriver(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                    />
                    <span className="text-[11px] font-medium text-slate-800">
                      Ushbu haydovchini transport haqiqiy egasiga / transportga amaldagi boshqaruvchi sifatida rasman biriktirish
                    </span>
                  </label>
                </div>
              )}

              {/* Row 3: Route & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("selectRoute")}
                  </label>
                  <select
                    className="input w-full"
                    value={formRouteId}
                    onChange={(e) => setFormRouteId(e.target.value)}
                  >
                    <option value="">Erkin yo&apos;nalish (shahar bo&apos;ylab)</option>
                    {routesApi.data?.items.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.origin} → {r.destination})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("notes")} (Ixtiyoriy)
                  </label>
                  <input
                    type="text"
                    className="input w-full text-xs"
                    placeholder="Alohida eslatmalar yoki qo'shimcha ma'lumot..."
                    value={formSpecialNotes}
                    onChange={(e) => setFormSpecialNotes(e.target.value)}
                  />
                </div>
              </div>

              {/* Row 4: Medical & Technical Check */}
              <div className="p-3 bg-slate-50 border rounded-xl space-y-3">
                <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Tibbiy va Texnik ko&apos;rik
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Medical */}
                  <div className="p-2.5 bg-white border rounded-lg space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formMedicalPassed}
                        onChange={(e) => setFormMedicalPassed(e.target.checked)}
                        className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                      />
                      <span className="text-xs font-bold text-slate-800">
                        🩺 Tibbiy ko&apos;rikdan o&apos;tdi
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input w-full text-xs"
                      placeholder={t("doctorName")}
                      value={formDoctorName}
                      onChange={(e) => setFormDoctorName(e.target.value)}
                    />
                  </div>

                  {/* Technical */}
                  <div className="p-2.5 bg-white border rounded-lg space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formTechnicalPassed}
                        onChange={(e) => setFormTechnicalPassed(e.target.checked)}
                        className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                      />
                      <span className="text-xs font-bold text-slate-800">
                        🔧 Texnik soz, ruxsat berildi
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input w-full text-xs"
                      placeholder={t("mechanicName")}
                      value={formMechanicName}
                      onChange={(e) => setFormMechanicName(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="btn btn-secondary"
                  disabled={saving}
                >
                  {tc("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary"
                >
                  {saving ? t("creating") : t("create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: PUTYOVKANI YAKUNLASH (RETURN ODOMETER & FUEL)               */}
      {/* ===================================================================== */}
      {closeTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{t("closeTitle")}</h3>
                <p className="text-xs text-slate-500">
                  {closeTarget.number} &bull; {closeTarget.driver.fullName} &bull; {formatUzPlate(closeTarget.vehicle.plateNumber)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCloseTarget(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            {closeError && <Alert tone="error">{closeError}</Alert>}

            <form onSubmit={handleCloseWaybill} className="space-y-4">
              <div className="p-3 bg-slate-50 border rounded-xl text-xs space-y-1">
                <div>
                  Chiqish spidometri:{" "}
                  <span className="font-mono font-bold text-slate-800">
                    {closeTarget.startOdometer !== null ? `${closeTarget.startOdometer} km` : "Qayd etilmagan"}
                  </span>
                </div>
                {closeOdometer && closeTarget.startOdometer !== null && parseInt(closeOdometer, 10) >= closeTarget.startOdometer && (
                  <div className="text-emerald-700 font-bold">
                    Bosib o&apos;tiladigan masofa: {parseInt(closeOdometer, 10) - closeTarget.startOdometer} km
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t("returnKm")} *
                </label>
                <input
                  type="number"
                  required
                  min={closeTarget.startOdometer ?? 0}
                  className="input w-full font-mono text-base font-bold"
                  value={closeOdometer}
                  onChange={(e) => setCloseOdometer(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("returnTime")}
                  </label>
                  <input
                    type="time"
                    required
                    className="input w-full"
                    value={closeReturnTime}
                    onChange={(e) => setCloseReturnTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {t("fuelAfter")}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className="input w-full"
                    placeholder="Qolgan yoqilg'i"
                    value={closeFuelAfter}
                    onChange={(e) => setCloseFuelAfter(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t("notes")}
                </label>
                <textarea
                  className="input w-full h-16 text-xs"
                  placeholder="Reys davomidagi holatlar, nosozliklar yoki eslatmalar..."
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setCloseTarget(null)}
                  className="btn btn-secondary"
                  disabled={closing}
                >
                  {tc("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={closing}
                  className="btn btn-primary"
                >
                  {closing ? t("closing") : t("finish")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: RASMIY YO'L VARAQASI (CHOP ETISH UCHUN BLANKA A4/A5)          */}
      {/* ===================================================================== */}
      {printTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto print:p-0 print:bg-white print:static print:overflow-visible">
          {/* Print isolation & page margin styles (Guaranteed 1 A4 Page) */}
          <style
            dangerouslySetInnerHTML={{
              __html: `
                @media print {
                  @page {
                    size: A4 portrait;
                    margin: 4mm 6mm !important;
                  }
                  html, body {
                    background: #ffffff !important;
                    color: #000000 !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                    max-height: 100% !important;
                    overflow: hidden !important;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                  }
                  /* Hide app layout, headers, navigation and backdrops */
                  body * {
                    visibility: hidden !important;
                  }
                  /* Show only the printable waybill container */
                  #printable-waybill-sheet,
                  #printable-waybill-sheet * {
                    visibility: visible !important;
                  }
                  #printable-waybill-sheet {
                    position: absolute !important;
                    left: 0 !important;
                    top: 0 !important;
                    width: 100% !important;
                    max-height: 280mm !important;
                    margin: 0 !important;
                    padding: 3mm 4mm !important;
                    box-sizing: border-box !important;
                    background: #ffffff !important;
                    color: #000000 !important;
                    border: 1.5px solid #000000 !important;
                    border-radius: 0 !important;
                    page-break-after: avoid !important;
                    break-after: avoid !important;
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                    overflow: hidden !important;
                  }
                  .print\\:hidden, .no-print {
                    display: none !important;
                  }
                }
              `,
            }}
          />

          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full p-4 sm:p-6 space-y-4 my-4 max-h-[95vh] overflow-y-auto print:max-w-none print:w-full print:p-0 print:m-0 print:shadow-none print:border-none print:overflow-visible">
            {/* Modal action bar (hidden during print) */}
            <div className="flex items-center justify-between border-b pb-2.5 print:hidden">
              <div>
                <div className="text-sm font-bold text-slate-800">
                  Yo&apos;l varaqasi &bull; <span className="font-mono text-emerald-700">{printTarget.number}</span>
                </div>
                <div className="text-xs text-slate-500">
                  A4 formatda 1 ta varaqqa to&apos;liq moslashtirilgan
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePrintWaybill(printTarget)}
                  className="btn btn-primary text-xs flex items-center gap-1.5 shadow-sm"
                >
                  🖨️ Chop etish (1 ta varaq)
                </button>
                <button
                  type="button"
                  onClick={() => setPrintTarget(null)}
                  className="btn btn-secondary text-xs"
                >
                  {tc("close")}
                </button>
              </div>
            </div>

            {/* Printable Document Sheet (Standard Uzbekistan Waybill Form - Strict 1 Page) */}
            <div
              id="printable-waybill-sheet"
              className="border-2 border-black p-3 space-y-2 text-black bg-white font-sans text-[11px] leading-tight print:p-2.5 print:border-2 print:border-black"
            >
              {/* Header: Title and Reg Number */}
              <div className="flex justify-between items-start border-b-2 border-black pb-1.5">
                <div>
                  <div className="text-[9px] uppercase font-bold tracking-widest text-slate-700">
                    O&apos;zbekiston Respublikasi Transport Vazirligi
                  </div>
                  <h2 className="text-base font-black uppercase tracking-tight text-black mt-0.5">
                    YO&apos;L VARAQASI (ПУТЕВОЙ ЛИСТ)
                  </h2>
                  <div className="font-mono font-black text-sm text-black">
                    № {printTarget.number}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] font-semibold text-slate-700">
                    Tashkilot (Tashuvchi):
                  </div>
                  <div className="text-xs font-black text-black">
                    {printTarget.company?.name ?? "Transport Korxonasi"}
                  </div>
                  <div className="text-[9.5px] text-slate-700 mt-0.5">
                    Sana: <b>{printTarget.date.slice(0, 10)}</b> &bull; Amal qiladi: <b>{printTarget.validUntil.slice(0, 10)}</b>
                  </div>
                </div>
              </div>

              {/* Vehicle, True Owner, and Current Driver info grid */}
              <div className="grid grid-cols-2 gap-2 border border-black rounded p-2 bg-slate-50/40 print:bg-white text-[10.5px]">
                <div className="space-y-1">
                  <div>
                    Avtomobil: <span className="font-black text-black">{printTarget.vehicle.model}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span>Davlat raqami:</span>
                    <span className="font-mono font-black text-xs px-1.5 py-0.5 border border-black rounded tracking-widest bg-white">
                      🇺🇿 {formatUzPlate(printTarget.vehicle.plateNumber)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-700">Transport haqiqiy egasi (mulkdor):</span>{" "}
                    <span className="font-black text-black underline decoration-slate-400">
                      {printTarget.vehicle.owner?.fullName ?? printTarget.company?.name ?? "Transport Korxonasi"}
                    </span>
                    {printTarget.vehicle.owner?.phone && (
                      <span className="font-mono text-[9.5px] text-slate-600 ml-1">
                        ({formatUzPhone(printTarget.vehicle.owner.phone)})
                      </span>
                    )}
                  </div>
                  <div className="text-[10px]">
                    Yo&apos;nalish:{" "}
                    <span className="font-bold text-black">
                      {printTarget.route
                        ? `${printTarget.route.name} (${printTarget.route.origin} → ${printTarget.route.destination})`
                        : "Erkin yo'nalish (shahar bo'ylab)"}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div>
                    <span className="text-slate-700">Amaldagi haydovchi (boshqaruvchi):</span>{" "}
                    <span className="font-black text-black underline decoration-slate-400">
                      {printTarget.driver.fullName}
                    </span>
                  </div>
                  <div>
                    Guvohnoma (Prava):{" "}
                    <span className="font-mono font-bold text-black">
                      {printTarget.driver.licenseNumber ?? "Mavjud"}
                    </span>
                  </div>
                  <div>
                    Aloqa telefoni:{" "}
                    <span className="font-mono font-semibold text-black">
                      {formatUzPhone(printTarget.driver.phone)}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-600">
                    Holati: <b className="text-emerald-800 print:text-black">Transportga rasman biriktirilgan</b>
                  </div>
                </div>
              </div>

              {/* Validity and Time card */}
              <div className="border border-black rounded p-2 bg-slate-50/40 print:bg-white text-[10.5px] flex items-center justify-between">
                <div>
                  Amal qilish muddati:{" "}
                  <span className="font-black text-black underline">
                    {printTarget.date ? printTarget.date.slice(0, 10) : ""} dan {printTarget.validUntil ? printTarget.validUntil.slice(0, 10) : printTarget.date.slice(0, 10)} gacha
                  </span>
                </div>
                <div>
                  Chiqish vaqti:{" "}
                  <span className="font-mono font-bold text-black">
                    {printTarget.departureTime
                      ? new Date(printTarget.departureTime).toLocaleTimeString("uz-UZ", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "08:00"}
                  </span>
                </div>
              </div>

              {/* Stamps and Signatures (Medical & Technical Inspection with clear PECHAT borders) */}
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                {/* Medical Stamp Block */}
                <div className="border border-black p-2 rounded space-y-1 flex flex-col justify-between">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-center border-b border-black pb-0.5 text-black">
                      Tibbiy Ko&apos;rik (Safar oldi)
                    </div>
                    <div className="text-[8.5px] leading-tight text-slate-800 mt-1">
                      Haydovchi safar oldi tibbiy ko&apos;rigidan o&apos;tkazildi. Spirtli ichimlik va giyohvand moddalar ta&apos;siri aniqlanmadi.
                    </div>
                    <div className="mt-1 text-[9.5px] space-y-0.5">
                      <div>
                        Holati:{" "}
                        <b className={printTarget.medicalPassed ? "text-emerald-800 print:text-black" : "text-red-700 print:text-black"}>
                          {printTarget.medicalPassed ? "✅ Sog'lom / Ruxsat berildi" : "❌ Ruxsat berilmadi"}
                        </b>
                      </div>
                      <div>
                        Shifokor: <b>{printTarget.medicalDoctorName ?? "Tibbiyot xodimi"}</b>
                      </div>
                      <div>
                        Vaqti:{" "}
                        <b>
                          {printTarget.medicalCheckedAt
                            ? new Date(printTarget.medicalCheckedAt).toLocaleTimeString("uz-UZ", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : (printTarget.departureTime
                                ? new Date(printTarget.departureTime).toLocaleTimeString("uz-UZ", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "07:45")}
                        </b>
                      </div>
                    </div>
                  </div>

                  {/* Muhr / Pechat chegarasi */}
                  <div className="mt-1 pt-1 border-t border-slate-300 flex items-center justify-between">
                    <div className="text-[9px] text-slate-800 font-medium">
                      Shifokor imzosi:<br />
                      <span className="font-mono">____________</span>
                    </div>
                    <div className="w-22 h-12 border-2 border-dashed border-black rounded flex flex-col items-center justify-center text-center p-0.5 bg-slate-50/40 print:bg-white flex-shrink-0">
                      <span className="text-[8px] font-black tracking-wider uppercase text-black">
                        M.O&apos;. / ПЕЧАТЬ
                      </span>
                      <span className="text-[7px] text-slate-600">
                        (Tibbiy muhr)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Technical Stamp Block */}
                <div className="border border-black p-2 rounded space-y-1 flex flex-col justify-between">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-center border-b border-black pb-0.5 text-black">
                      Texnik Ko&apos;rik (Safar oldi)
                    </div>
                    <div className="text-[8.5px] leading-tight text-slate-800 mt-1">
                      Avtomobilning tormoz, rul boshqaruvi, shinalar, chiroqlar va xavfsizlik tizimlari tekshirildi, texnik soz holatda.
                    </div>
                    <div className="mt-1 text-[9.5px] space-y-0.5">
                      <div>
                        Holati:{" "}
                        <b className={printTarget.technicalPassed ? "text-emerald-800 print:text-black" : "text-red-700 print:text-black"}>
                          {printTarget.technicalPassed ? "✅ Texnik soz / Ruxsat berildi" : "❌ Nosoz"}
                        </b>
                      </div>
                      <div>
                        Mexanik: <b>{printTarget.mechanicName ?? "Mas'ul mexanik"}</b>
                      </div>
                      <div>
                        Vaqti:{" "}
                        <b>
                          {printTarget.technicalCheckedAt
                            ? new Date(printTarget.technicalCheckedAt).toLocaleTimeString("uz-UZ", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : (printTarget.departureTime
                                ? new Date(printTarget.departureTime).toLocaleTimeString("uz-UZ", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "07:50")}
                        </b>
                      </div>
                    </div>
                  </div>

                  {/* Muhr / Pechat chegarasi */}
                  <div className="mt-1 pt-1 border-t border-slate-300 flex items-center justify-between">
                    <div className="text-[9px] text-slate-800 font-medium">
                      Mexanik imzosi:<br />
                      <span className="font-mono">____________</span>
                    </div>
                    <div className="w-22 h-12 border-2 border-dashed border-black rounded flex flex-col items-center justify-center text-center p-0.5 bg-slate-50/40 print:bg-white flex-shrink-0">
                      <span className="text-[8px] font-black tracking-wider uppercase text-black">
                        M.O&apos;. / ПЕЧАТЬ
                      </span>
                      <span className="text-[7px] text-slate-600">
                        (Texnik muhr)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Verification Section with QR Code */}
              <div className="border-t-2 border-black pt-1.5 flex items-center justify-between gap-3">
                <div className="space-y-0.5 text-[9.5px] flex-1">
                  <div>
                    Mas&apos;ul shaxs imzosi: <span className="font-mono">_______________________</span>
                  </div>
                  <div className="text-[8.5px] text-slate-600 leading-tight">
                    Ushbu yo&apos;l varaqasi transport vositasining qonuniy reysga chiqishiga asos bo&apos;ladi. YPX (DYHXX) va Transport Nazorati inspektorlari o&apos;ng tarafdagi QR kod orqali haqiqiylikni onlayn tekshirishi mumkin.
                  </div>
                  <div className="text-[8px] font-mono text-slate-500">
                    Hujjat ID: {printTarget.publicToken}
                  </div>
                </div>

                {/* QR Code with crisp border */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className="p-0.5 border border-black rounded bg-white">
                    <img
                      src={`/api/proxy/waybills/public-verify/${printTarget.publicToken}/qr`}
                      alt="QR Tekshiruv"
                      width={56}
                      height={56}
                      className="w-[56px] h-[56px]"
                    />
                  </div>
                  <span className="text-[7px] font-bold uppercase tracking-wider text-slate-700 mt-0.5">
                    YPX QR Tekshiruv
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
