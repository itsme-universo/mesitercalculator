import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";

/**
 * 대구농업마이스터고 1차 전형 모의 성적 계산기 (+ 엑셀 업로드/템플릿)
 */

// 전형/유형
type TrackType = "일반전형" | "특별전형";
type ApplicantType = "졸업예정자" | "졸업생" | "검정고시";

// 학기 메타
const SEMS = [
  { key: "1-1", year: 1, label: "1학년 1학기" },
  { key: "1-2", year: 1, label: "1학년 2학기" },
  { key: "2-1", year: 2, label: "2학년 1학기" },
  { key: "2-2", year: 2, label: "2학년 2학기" },
  { key: "3-1", year: 3, label: "3학년 1학기" },
  { key: "3-2", year: 3, label: "3학년 2학기" },
] as const;

// 학기별 기본 계수(유형별)
function baseCoeff(atype: ApplicantType, semKey: string) {
  if (atype === "검정고시") return 0;
  if (atype === "졸업예정자") {
    const map: Record<string, number> = { "1-1": 2, "1-2": 2, "2-1": 4, "2-2": 4, "3-1": 8, "3-2": 0 };
    return map[semKey] ?? 0;
  }
  const map: Record<string, number> = { "1-1": 2, "1-2": 2, "2-1": 4, "2-2": 4, "3-1": 4, "3-2": 4 };
  return map[semKey] ?? 0;
}

// 등급 옵션
const GRADE_5 = [
  { value: "A/수", display: "A/수" },
  { value: "B/우", display: "B/우" },
  { value: "C/미", display: "C/미" },
  { value: "D/양", display: "D/양" },
  { value: "E/가", display: "E/가" },
] as const;
const GRADE_3 = [
  { value: "A/우수", display: "A/우수" },
  { value: "B/보통", display: "B/보통" },
  { value: "C/미흡", display: "C/미흡" },
] as const;

// 등급→점수
function mapGradeToPoint(v?: string | null) {
  const t = (v || "").trim();
  const map: Record<string, number> = {
    "A/수": 5, "B/우": 4, "C/미": 3, "D/양": 2, "E/가": 1,
    "A/우수": 5, "B/보통": 4, "C/미흡": 3,
    A: 5, B: 4, C: 3, D: 2, E: 1,
  };
  if (!t) return null;
  return map[t] ?? null;
}
function round3(x: number) {
  return Math.round((x + Number.EPSILON) * 1000) / 1000;
}
function scoreToPointGED(s: number) {
  if (s >= 95) return 5;
  if (s >= 90) return 4;
  if (s >= 85) return 3;
  if (s >= 80) return 2;
  return 1;
}

type SubjRow = { name: string; grade: string };

interface AgricultureCalculatorProps {
  onBack?: () => void;
}

export default function AgricultureCalculator({ onBack }: AgricultureCalculatorProps) {
  const [track, setTrack] = useState<TrackType>("일반전형");
  const [atype, setAtype] = useState<ApplicantType>("졸업예정자");

  const [subs, setSubs] = useState<Record<string, SubjRow[]>>(() => {
    const init: Record<string, SubjRow[]> = {};
    for (const s of SEMS) init[s.key] = [{ name: "", grade: "" }];
    return init;
  });
  const [freeSem, setFreeSem] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const s of SEMS) init[s.key] = false;
    return init;
  });
  const [gedSubs, setGedSubs] = useState<{ subject: string; score: number }[]>([]);

  // 업로드 상태
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string>("");

  // 자유학기 유효성 (검정고시 제외 전 트랙)
  const freeSemValidWithinOneYear = useMemo(() => {
    if (atype === "검정고시") return true;
    const selected = Object.keys(freeSem).filter((k) => freeSem[k] && baseCoeff(atype, k) > 0);
    if (selected.length === 0) return true;
    const years = new Set<number>();
    for (const k of selected) {
      const m = SEMS.find((s) => s.key === k);
      if (m) years.add(m.year);
    }
    return years.size <= 1;
  }, [freeSem, atype]);

  // 학기 평균
  function semStats(semKey: string) {
    const rows = subs[semKey] || [];
    let cnt = 0, num = 0, den = 0;
    for (const r of rows) {
      const p = mapGradeToPoint(r.grade);
      if (p == null) continue;
      num += p; den += 1; cnt += 1;
    }
    const avg = den === 0 ? 0 : num / den;
    return { count: cnt, avg };
  }

  // 실효 계수 (자유학기 반영: 검정고시 제외 전 트랙 / 규칙3 ex2)
  const effectiveCoeffs = useMemo(() => {
    const eff: Record<string, number> = {};
    for (const s of SEMS) eff[s.key] = baseCoeff(atype, s.key);

    if (atype !== "검정고시") {
      // 규칙2: 학년 내 한 학기만 자유 → 다른 학기에 연간 합계 몰아주기
      for (const year of [1, 2, 3]) {
        const yearSems = SEMS.filter((s) => s.year === year && baseCoeff(atype, s.key) > 0);
        if (yearSems.length === 0) continue;
        const baseYearTotal = yearSems.reduce((a, s) => a + baseCoeff(atype, s.key), 0);
        const marked = yearSems.filter((s) => freeSem[s.key]).length;

        if (marked === 1) {
          const kept = yearSems.find((s) => !freeSem[s.key]);
          const freed = yearSems.find((s) => freeSem[s.key]);
          if (kept && freed) {
            eff[freed.key] = 0;
            eff[kept.key] = baseYearTotal;
          } else {
            for (const s of yearSems) eff[s.key] = 0;
          }
        } else if (marked >= yearSems.length) {
          for (const s of yearSems) eff[s.key] = 0;
        }
      }

      // 규칙3: 학년 전체 자유 → 차상학년 이관 (1→2, 2→1, 3→2)
      const addToYear = (targetYear: number, add: number) => {
        if (add <= 0) return;
        const tSems = SEMS.filter((s) => s.year === targetYear && baseCoeff(atype, s.key) > 0);
        if (tSems.length === 0) return;
        const currentTotal = tSems.reduce((a, s) => a + eff[s.key], 0);
        if (currentTotal > 0) {
          for (const s of tSems) {
            const ratio = eff[s.key] / currentTotal;
            eff[s.key] += add * ratio;
          }
        } else {
          const baseTotal = tSems.reduce((a, s) => a + baseCoeff(atype, s.key), 0);
          for (const s of tSems) {
            const b = baseCoeff(atype, s.key);
            eff[s.key] += add * (b / baseTotal);
          }
        }
      };

      const yearEffTotal = (y: number) =>
        SEMS.filter((s) => s.year === y && baseCoeff(atype, s.key) > 0).reduce((a, s) => a + eff[s.key], 0);
      const yearBaseTotal = (y: number) =>
        SEMS.filter((s) => s.year === y && baseCoeff(atype, s.key) > 0).reduce((a, s) => a + baseCoeff(atype, s.key), 0);

      if (yearEffTotal(1) === 0 && yearBaseTotal(1) > 0) addToYear(2, yearBaseTotal(1));
      if (yearEffTotal(2) === 0 && yearBaseTotal(2) > 0) addToYear(1, yearBaseTotal(2)); // ex2
      if (yearEffTotal(3) === 0 && yearBaseTotal(3) > 0) addToYear(2, yearBaseTotal(3));
    }

    // 합계 = 20 유지
    const targetSum = 20;
    const currentSum = Object.values(eff).reduce((a, b) => a + b, 0);
    if (currentSum > 0 && Math.abs(currentSum - targetSum) > 1e-9) {
      const k = targetSum / currentSum;
      for (const k2 of Object.keys(eff)) eff[k2] *= k;
    }
    return eff;
  }, [atype, freeSem]);

  // 점수
  const calcCourseScoreRegular = () => {
    let sum = 0;
    for (const s of SEMS) {
      const w = effectiveCoeffs[s.key];
      if (w <= 0) continue;
      const { avg } = semStats(s.key);
      sum += avg * w;
    }
    const factor = track === "일반전형" ? 0.4 : 0.3; // 40/30
    return sum * factor;
  };
  const calcCourseScoreGED = () => {
    if (gedSubs.length === 0) return 0;
    const pts = gedSubs.filter((v) => Number.isFinite(v.score)).map((v) => scoreToPointGED(v.score));
    if (pts.length === 0) return 0;
    const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
    const factor = track === "일반전형" ? 8 : 6; // 40/30
    return avg * factor;
  };

  const { courseScore, totalScore, courseMax } = useMemo(() => {
    if (atype === "검정고시") {
      const c = round3(calcCourseScoreGED());
      const max = track === "일반전형" ? 40 : 30;
      return { courseScore: c, totalScore: c, courseMax: max };
    } else {
      const c = round3(calcCourseScoreRegular());
      const max = track === "일반전형" ? 40 : 30;
      return { courseScore: c, totalScore: c, courseMax: max };
    }
  }, [atype, track, subs, freeSem, gedSubs, effectiveCoeffs]);

  // UI 유틸
  const isSemDisabled = (semKey: string) => {
    if (atype === "검정고시") return true;
    const bw = baseCoeff(atype, semKey);
    if (bw <= 0) return true;
    if (freeSem[semKey]) return true; // 자유학기면 비활성
    return false;
  };

  const addRow = (semKey: string) =>
    setSubs((prev) => ({ ...prev, [semKey]: [...(prev[semKey] || []), { name: "", grade: "" }] }));
  const clearRows = (semKey: string) => setSubs((prev) => ({ ...prev, [semKey]: [{ name: "", grade: "" }] }));
  const updateRow = (semKey: string, idx: number, patch: Partial<SubjRow>) =>
    setSubs((prev) => {
      const list = [...(prev[semKey] || [])];
      list[idx] = { ...list[idx], ...patch };
      return { ...prev, [semKey]: list };
    });
  const removeRow = (semKey: string, idx: number) =>
    setSubs((prev) => {
      const list = [...(prev[semKey] || [])];
      list.splice(idx, 1);
      if (list.length === 0) list.push({ name: "", grade: "" });
      return { ...prev, [semKey]: list };
    });

  // ---------- 엑셀 업로드 ----------
  const handleFilePick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadMsg("파일을 처리 중입니다…");

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (atype === "검정고시") {
        // 검정고시: 첫 시트 2열(과목/점수) 가정
        const newGed: { subject: string; score: number }[] = [];
        for (const r of jsonData as any[]) {
          const subject = String(r["과목명"] ?? r["과목"] ?? "").trim();
          const scoreRaw = r["점수(0-100)"] ?? r["점수"] ?? r["score"] ?? "";
          const score = Number(scoreRaw);
          if (!subject || !Number.isFinite(score)) continue;
          newGed.push({ subject, score: Math.max(0, Math.min(100, score)) });
        }
        setGedSubs(newGed);
        setUploadMsg(`검정고시 과목 ${newGed.length}건을 불러왔습니다.`);
      } else {
        // 일반/졸업: 그리드형 또는 교과 시트 파싱
        const newSubjects: Record<string, SubjRow[]> = {};
        for (const s of SEMS) newSubjects[s.key] = [];

        // 그리드형 파싱 시도 (B5:M25)
        let parsed = false;
        try {
          const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            range: "B5:M25",
            blankrows: false,
            defval: "",
          });

          const pairs: Array<[string, [number, number]]> = [
            ["1-1", [0, 1]], ["1-2", [2, 3]], ["2-1", [4, 5]], ["2-2", [6, 7]], ["3-1", [8, 9]], ["3-2", [10, 11]],
          ];

          for (let i = 0; i < rows.length; i++) {
            const r = rows[i] || [];
            for (const [sem, [subjIdx, gradeIdx]] of pairs) {
              const name = String(r[subjIdx] ?? "").trim();
              const grade = String(r[gradeIdx] ?? "").trim();
              if (!name && !grade) continue;
              if (!name || !grade) continue;
              if (!SEMS.some((s) => s.key === sem)) continue;
              if (baseCoeff(atype, sem) <= 0) continue;
              if (mapGradeToPoint(grade) == null) continue;
              newSubjects[sem].push({ name, grade });
            }
          }
          parsed = true;
        } catch (e) {
          // 그리드 파싱 실패 시 교과 시트 시도
        }

        if (!parsed) {
          // 교과 시트 파싱
          const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          for (const r of rows) {
            const sem = String((r as any)["학기"] ?? (r as any)["semester"] ?? (r as any)["Sem"] ?? "").trim();
            const name = String((r as any)["과목명"] ?? (r as any)["과목"] ?? (r as any)["subject"] ?? "").trim();
            const grade = String((r as any)["등급"] ?? (r as any)["grade"] ?? "").trim();
            if (!sem || !name || !grade) continue;
            if (!SEMS.some((s) => s.key === sem)) continue;
            if (baseCoeff(atype, sem) <= 0) continue;
            if (mapGradeToPoint(grade) == null) continue;
            newSubjects[sem].push({ name, grade });
          }
        }

        // 빈 학기는 기본 행 추가
        for (const s of SEMS) {
          if (!newSubjects[s.key] || newSubjects[s.key].length === 0) {
            newSubjects[s.key] = [{ name: "", grade: "" }];
          }
        }

        setSubs(newSubjects);
        const totalRows = Object.values(newSubjects).reduce((a, b) => a + b.length, 0);
        setUploadMsg(`성공적으로 업로드되었습니다. (${totalRows}개 과목)`);
      }
    } catch (error) {
      setUploadMsg("파일 업로드 중 오류가 발생했습니다.");
      console.error("Upload error:", error);
    }
  };

  const downloadGridTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet1");

    // 열 너비 설정
    const allCols = ["B","C","D","E","F","G","H","I","J","K","L","M"];
    const widths: Record<string, number> = { B: 18, C: 10, D: 18, E: 10, F: 18, G: 10, H: 18, I: 10, J: 18, K: 10, L: 18, M: 10 };
    allCols.forEach((col) => (worksheet.getColumn(col).width = widths[col]));

    // 공통 스타일
    const center = { vertical: "middle", horizontal: "center" } as const;
    const bold = { bold: true } as const;
    const white = { argb: "FFFFFFFF" };
    const black = { argb: "FF000000" };

    // 타이틀 병합
    worksheet.mergeCells("B2:E2"); worksheet.getCell("B2").value = "1학년";
    worksheet.mergeCells("F2:I2"); worksheet.getCell("F2").value = "2학년";
    worksheet.mergeCells("J2:M2"); worksheet.getCell("J2").value = "3학년";

    // 타이틀 색상
    worksheet.getCell("B2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F81BD" } };
    worksheet.getCell("B2").font = { ...bold, color: white };
    worksheet.getCell("F2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD966" } };
    worksheet.getCell("F2").font = { ...bold, color: black };
    worksheet.getCell("J2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFA9D18E" } };
    worksheet.getCell("J2").font = { ...bold, color: black };
    worksheet.getCell("B2").alignment = center; worksheet.getCell("F2").alignment = center; worksheet.getCell("J2").alignment = center;

    // 학기 병합 라벨
    ([
      ["B3:C3", "1학년 1학기"], ["D3:E3", "1학년 2학기"],
      ["F3:G3", "2학년 1학기"], ["H3:I3", "2학년 2학기"],
      ["J3:K3", "3학년 1학기"], ["L3:M3", "3학년 2학기"],
    ] as const).forEach(([rng, label]) => {
      worksheet.mergeCells(rng);
      const cell = worksheet.getCell(rng.split(":")[0]);
      cell.value = label;
      cell.font = bold;
      cell.alignment = center;
    });

    // 헤더 라인 (B4:M4)
    ([
      ["B4", "과목명"], ["C4", "등급"], ["D4", "과목명"], ["E4", "등급"],
      ["F4", "과목명"], ["G4", "등급"], ["H4", "과목명"], ["I4", "등급"],
      ["J4", "과목명"], ["K4", "등급"], ["L4", "과목명"], ["M4", "등급"],
    ] as const).forEach(([addr, text]) => {
      const c = worksheet.getCell(addr);
      c.value = text;
      c.font = bold;
      c.alignment = center;
    });

    // 전체 얇은 테두리 (B2:M25)
    for (let r = 2; r <= 25; r++) {
      for (const col of allCols) {
        const cell = worksheet.getCell(`${col}${r}`);
        cell.border = {
          top: { style: "thin", color: { argb: "FFADB5BD" } },
          left: { style: "thin", color: { argb: "FFADB5BD" } },
          bottom: { style: "thin", color: { argb: "FFADB5BD" } },
          right: { style: "thin", color: { argb: "FFADB5BD" } },
        };
      }
    }

    // 학년/학기 구분선 굵게
    const thickCols = ["E","I","M"]; // 학년 블록 우측
    for (let r = 2; r <= 25; r++) {
      for (const col of thickCols) {
        const prev: any = worksheet.getCell(`${col}${r}`).border || {};
        (worksheet.getCell(`${col}${r}`) as any).border = { ...prev, right: { style: "medium", color: { argb: "FF6B7280" } } };
      }
    }

    // 외곽 thick 테두리
    const outerColor = { argb: "FF111827" };
    const leftCol = "B", rightCol = "M", topRow = 2, bottomRow = 25;
    const patchBorder = (addr: string, patch: any) => {
      const cell = worksheet.getCell(addr);
      const prev: any = cell.border || {};
      (cell as any).border = { ...prev, ...patch };
    };
    // Top & Bottom
    for (let code = leftCol.charCodeAt(0); code <= rightCol.charCodeAt(0); code++) {
      const col = String.fromCharCode(code);
      patchBorder(`${col}${topRow}`, { top: { style: "thick", color: outerColor } });
      patchBorder(`${col}${bottomRow}`, { bottom: { style: "thick", color: outerColor } });
    }
    // Left & Right
    for (let r = topRow; r <= bottomRow; r++) {
      patchBorder(`${leftCol}${r}`, { left: { style: "thick", color: outerColor } });
      patchBorder(`${rightCol}${r}`, { right: { style: "thick", color: outerColor } });
    }

    // 등급 유효성 검사
    const gradeCols = ["C","E","G","I","K","M"];
    const gradeList = ["A/수","B/우","C/미","D/양","E/가","A/우수","B/보통","C/미흡"];
    const listFormula = `"${gradeList.join(",")}"`;
    for (let r = 5; r <= 25; r++) {
      for (const col of gradeCols) {
        worksheet.getCell(`${col}${r}`).alignment = center;
        (worksheet as any).dataValidations.add(`${col}${r}`, {
          type: "list",
          allowBlank: true,
          formulae: [listFormula],
          showErrorMessage: true,
          errorStyle: "warning",
          errorTitle: "유효하지 않은 등급",
          error: "등급은 제공된 목록에서 선택하세요.",
        });
      }
    }

    // 파일 다운로드
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "대농마_성적입력_그리드_샘플.xlsx";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <style>{`
        @import url('https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css');
        *, *::before, *::after{ box-sizing: border-box; }
        :root{
          --gray-50:#f8fafc; --gray-80:#f5f7fa; --gray-100:#f1f5f9; --gray-200:#e2e8f0;
          --gray-300:#cbd5e1; --gray-400:#94a3b8; --gray-500:#64748b; --gray-600:#475569;
          --gray-700:#334155; --gray-900:#0f172a; --white:#ffffff;
          --radius-sm:8px; --radius-md:10px; --radius-lg:12px; --ring-focus:2px;
        }
        .page{
          width:960px; min-width:960px; max-width:960px; margin:0 auto;
          color: var(--gray-900); background: var(--white); min-height:100vh; padding:28px;
          font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial;
          font-size:14px;
        }
        h1{ font-size:18px; font-weight:800; margin:0 0 10px }
        h3{ font-size:16px; font-weight:700; margin:0 0 10px }
        .muted{ font-size:12px; color: var(--gray-500); line-height:1.6 }
        .kpi{ font-size:16px; font-weight:800 }
        .stack{ display:flex; gap:12px; flex-wrap:wrap; align-items:center }
        .card{ background:var(--white); border:1px solid var(--gray-200); border-radius:var(--radius-lg); padding:12px }
        .subcard{ background:var(--gray-50); border:1px dashed var(--gray-200); border-radius:var(--radius-md); padding:10px }
        .err{ color:#b91c1c; font-size:12px; margin-top:6px }
        .ui-input, .ui-select{
          width:100%; border:1px solid var(--gray-300); background:var(--gray-50); color:var(--gray-900);
          border-radius:var(--radius-sm); padding:8px 12px; transition: all .15s ease; outline:none; appearance:none; font-size:14px;
        }
        .ui-input::placeholder{ color:var(--gray-400) }
        .ui-input:hover, .ui-select:hover{ background:var(--gray-80) }
        .ui-input:focus, .ui-select:focus{ border-color: var(--gray-900); outline: var(--ring-focus) solid var(--gray-900) }
        .ui-input:disabled, .ui-select:disabled{ background:var(--gray-100); color: var(--gray-400); border-color: var(--gray-200); cursor:not-allowed }
        .btn{ border:1px solid var(--gray-300); background:var(--white); border-radius:8px; padding:8px 10px; cursor:pointer; font-size:14px }
        .btn:hover{ background: var(--gray-80) }
        .btn:disabled{ background: var(--gray-100); color: var(--gray-400); border-color: var(--gray-200); cursor:not-allowed }
        .sem-box{ border:1px solid var(--gray-200); border-radius:10px; overflow:hidden }
        .sem-head{ display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 10px; background:var(--gray-50); border-bottom:1px solid var(--gray-200) }
        .row-grid{ display:grid; grid-template-columns: 2fr 1fr auto; gap:8px; align-items:center; }
        .grid-2{ display:grid; grid-template-columns: repeat(2, 1fr); gap:12px; }
        .year-block{ margin-top:12px }
        .year-title{ font-size:14px; color: var(--gray-600); font-weight:700; margin: 6px 2px }
        .year-grid{ display:grid; grid-template-columns: 1fr 1fr; gap:12px }
        input[type="radio"], input[type="checkbox"]{ accent-color:#22c55e }
      `}</style>

      <button className="btn" onClick={onBack || (() => window.history.back())} style={{ marginBottom: "20px" }}>
        ← 목록으로
      </button>

      <h1>대구농업마이스터고 1차 전형 모의 성적 계산기</h1>
      <div className="muted" style={{ margin: "10px 0" }}>
        • 본 계산기는 <b>1차 전형</b>만 대상으로 합니다. (2차 전형의 면접/소양평가 등은 제외) <br />
        • <b>생활기록부 등재</b> 기준으로만 인정하며, 출결 등 기준일은 <b>2025-09-30</b> (졸업생은 졸업일 기준) 입니다. <br />
        • 음악·미술·체육 과목도 교과성적에 <b>반영</b>합니다. <b>P/F 과목은 입력하지 마세요</b> (반영 제외).
      </div>

      {/* 전형/유형 */}
      <section className="card" style={{ marginBottom: 16 }}>
        <h3>전형 · 지원 유형</h3>
        <div className="stack">
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>전형</div>
            {(["일반전형", "특별전형"] as TrackType[]).map((t) => (
              <label key={t} style={{ display: "inline-flex", gap: 6, alignItems: "center", marginRight: 12 }}>
                <input type="radio" name="track" checked={track === t} onChange={() => setTrack(t)} /> {t}
              </label>
            ))}
          </div>
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>지원 유형</div>
            {(["졸업예정자", "졸업생", "검정고시"] as ApplicantType[]).map((t) => (
              <label key={t} style={{ display: "inline-flex", gap: 6, alignItems: "center", marginRight: 12 }}>
                <input type="radio" name="atype" checked={atype === t} onChange={() => setAtype(t)} /> {t}
              </label>
            ))}
          </div>
        </div>

        {/* 업로드/템플릿 */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: 10, border: "1px dashed var(--gray-300)", background: "var(--gray-50)", borderRadius: 10, marginTop: 10, fontSize: 14 }}>
          <button className="btn" onClick={downloadGridTemplate}>샘플 엑셀 다운로드(그리드)</button>

          <input
            ref={fileInputRef}
            onChange={onFileChange}
            onClick={(e) => {
              (e.currentTarget as HTMLInputElement).value = "";
            }}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: "none" }}
          />
          <button className="btn" onClick={handleFilePick}>엑셀 업로드</button>

          <small style={{ color: "var(--gray-500)", fontSize: 12 }}>
            단일 시트 그리드(B2~M25) 또는 "교과" 시트(학기/과목명/등급) 형식을 지원합니다.
          </small>
          {uploadMsg && <small style={{ marginLeft: 8, color: "var(--gray-500)", fontSize: 12 }}>{uploadMsg}</small>}
        </div>
      </section>

      {/* 교과 입력 (검정고시 제외) */}
      {atype !== "검정고시" && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3>교과 성적 입력</h3>
          <div className="muted">
            과목을 직접 추가하세요. <b>P/F</b> 과목은 입력하지 않습니다. (등급 미선택 시 자동 제외)
            <br />(5등급: A/수~E/가 · 3등급: A/우수~C/미흡)
          </div>

          {/* 학년별 2열 그리드 */}
          {[1, 2, 3].map((year) => (
            <div key={year} className="year-block">
              <div className="year-title">{year}학년</div>
              <div className="year-grid">
                {SEMS.filter((s) => s.year === year).map((s) => {
                  const bw = baseCoeff(atype, s.key);
                  const disabled = isSemDisabled(s.key);
                  const rows = subs[s.key] || [];
                  const { count, avg } = semStats(s.key);
                  const effW = effectiveCoeffs[s.key] || 0;
                  const hideInputs = bw <= 0;

                  return (
                    <div key={s.key} className={`sem-box ${disabled ? "dim" : ""}`}>
                      <div className="sem-head">
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <strong>학기: {s.key}</strong>
                            <span className="muted">기본 ×{bw} · 실효 ×{round3(effW)}</span>
                          </div>
                          <div className="muted" style={{ marginTop: 4 }}>
                            반영 행: <b>{count}</b> · 평균 미리보기: <b>{round3(avg).toFixed(3)}</b>
                          </div>
                        </div>
                        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            disabled={bw <= 0}
                            checked={!!freeSem[s.key]}
                            onChange={(e) => setFreeSem((prev) => ({ ...prev, [s.key]: e.target.checked }))}
                          />
                          자유학기
                        </label>
                      </div>

                      <div style={{ padding: 10 }}>
                        {/* 헤더 */}
                        <div className="row-grid muted" style={{ marginBottom: 4 }}>
                          <div>과목명</div>
                          <div>등급(5·3등급)</div>
                          <div style={{ textAlign: "right" }}>행</div>
                        </div>

                        {/* 입력 행 */}
                        {rows.map((row, idx) => (
                          <div key={idx} className="row-grid" style={{ marginBottom: 8 }}>
                            <input
                              className="ui-input"
                              placeholder="예) 국어, 수학, 체육, 음악..."
                              value={row.name}
                              onChange={(e) => updateRow(s.key, idx, { name: e.target.value })}
                              disabled={disabled || hideInputs}
                            />
                            <select
                              className="ui-select"
                              value={row.grade}
                              onChange={(e) => updateRow(s.key, idx, { grade: e.target.value })}
                              disabled={disabled || hideInputs}
                            >
                              <option value="">—</option>
                              <optgroup label="5등급 (A/수~E/가)">
                                {GRADE_5.map((g) => (
                                  <option key={g.value} value={g.value}>{g.display}</option>
                                ))}
                              </optgroup>
                              <optgroup label="3등급 (A/우수~C/미흡)">
                                {GRADE_3.map((g) => (
                                  <option key={g.value} value={g.value}>{g.display}</option>
                                ))}
                              </optgroup>
                            </select>
                            <div style={{ textAlign: "right" }}>
                              <button className="btn" onClick={() => removeRow(s.key, idx)} disabled={disabled || hideInputs}>
                                삭제
                              </button>
                            </div>
                          </div>
                        ))}

                        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                          <button className="btn" onClick={() => addRow(s.key)} disabled={disabled || hideInputs}>과목 추가</button>
                          <button className="btn" onClick={() => clearRows(s.key)} disabled={disabled || hideInputs}>모두 지우기</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 검정고시 입력 */}
      {atype === "검정고시" && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3>검정고시 과목 점수 (과목명 / 0~100)</h3>
          <div className="muted">환산: 95~100→5, 90~95→4, 85~90→3, 80~85→2, 80미만→1 → 일반×8=40 / 특별×6=30</div>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {gedSubs.map((item, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <input
                  className="ui-input"
                  placeholder="과목명"
                  value={item.subject}
                  onChange={(e) =>
                    setGedSubs((prev) => prev.map((v, idx) => (idx === i ? { ...v, subject: e.target.value } : v)))
                  }
                />
                <input
                  className="ui-input"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={item.score}
                  onChange={(e) =>
                    setGedSubs((prev) =>
                      prev.map((v, idx) =>
                        idx === i ? { ...v, score: Math.min(100, Math.max(0, Number(e.target.value))) } : v
                      )
                    )
                  }
                  style={{ width: 160 }}
                />
                <button className="btn" onClick={() => setGedSubs((prev) => prev.filter((_, idx) => idx !== i))}>
                  삭제
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn" onClick={() => setGedSubs((prev) => [...prev, { subject: "", score: 0 }])}>과목 추가</button>
            <button className="btn" onClick={() => setGedSubs([])}>모두 지우기</button>
          </div>
        </section>
      )}

      {/* 결과 */}
      <section className="card">
        <h3>결과</h3>
        <div className="grid-2">
          <div>
            <div className="muted">교과 성적 ({courseMax})</div>
            <div className="kpi">{courseScore.toFixed(3)}</div>
          </div>
          <div>
            <div className="muted">총점 (교과만, {courseMax}점 만점)</div>
            <div className="kpi">{totalScore.toFixed(3)}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
