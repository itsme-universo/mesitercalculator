import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";

/**
 * 대구일마이스터고 1차 전형 모의 성적 계산기
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

// 학기별 기본 가중치 (전형 × 유형)
function baseWeight(track: TrackType, atype: ApplicantType, semKey: string) {
  if (track === "일반전형") {
    if (atype === "졸업예정자") {
      const map: Record<string, number> = {
        "1-1": 1.2,
        "1-2": 1.2,
        "2-1": 1.8,
        "2-2": 1.8,
        "3-1": 6.0,
        "3-2": 0,
      };
      return map[semKey] ?? 0;
    } else if (atype === "졸업생") {
      const map: Record<string, number> = {
        "1-1": 1.2,
        "1-2": 1.2,
        "2-1": 1.8,
        "2-2": 1.8,
        "3-1": 3.0,
        "3-2": 3.0,
      };
      return map[semKey] ?? 0;
    } else {
      return 0; // 검정고시는 학기 가중 미사용
    }
  } else {
    // 특별전형
    if (atype === "졸업예정자") {
      const map: Record<string, number> = {
        "1-1": 1.0,
        "1-2": 1.0,
        "2-1": 1.5,
        "2-2": 1.5,
        "3-1": 5.0,
        "3-2": 0,
      };
      return map[semKey] ?? 0;
    } else if (atype === "졸업생") {
      const map: Record<string, number> = {
        "1-1": 1.0,
        "1-2": 1.0,
        "2-1": 1.5,
        "2-2": 1.5,
        "3-1": 2.5,
        "3-2": 2.5,
      };
      return map[semKey] ?? 0;
    } else {
      return 0;
    }
  }
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

function mapGradeToPoint(v?: string | null) {
  const t = (v || "").trim();
  const map: Record<string, number> = {
    "A/수": 5,
    "B/우": 4,
    "C/미": 3,
    "D/양": 2,
    "E/가": 1,
    "A/우수": 5,
    "B/보통": 4,
    "C/미흡": 3,
    A: 5,
    B: 4,
    C: 3,
    D: 2,
    E: 1,
  };
  if (!t) return null;
  return map[t] ?? null;
}

function round3(x: number) {
  return Math.round((x + Number.EPSILON) * 1000) / 1000;
}

// 검정고시 환산
function scoreToPointGED(s: number) {
  if (s >= 95) return 5;
  if (s >= 90) return 4;
  if (s >= 85) return 3;
  if (s >= 80) return 2;
  return 1;
}

// 타입들
type SubjRow = { name: string; grade: string };
type AttRow = { absent: number; lateEtc: number };

function clampInt(v: any) {
  const n = Math.floor(Number(v) || 0);
  return n < 0 ? 0 : n;
}

interface IlCalculatorProps {
  onBack?: () => void;
}

export default function IlCalculator({ onBack }: IlCalculatorProps) {
  // 전형/유형
  const [track, setTrack] = useState<TrackType>("일반전형");
  const [atype, setAtype] = useState<ApplicantType>("졸업예정자");

  // 교과 입력
  const [subs, setSubs] = useState<Record<string, SubjRow[]>>(() => {
    const init: Record<string, SubjRow[]> = {};
    for (const s of SEMS) init[s.key] = [{ name: "", grade: "" }];
    return init;
  });

  // 자유학기 (전 전형 적용, 검정고시 제외)
  const [freeSem, setFreeSem] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const s of SEMS) init[s.key] = false;
    return init;
  });

  // 검정고시 과목
  const [gedSubs, setGedSubs] = useState<{ subject: string; score: number }[]>(
    []
  );

  // 학기별 출결
  const [attBySem, setAttBySem] = useState<Record<string, AttRow>>(() => {
    const init: Record<string, AttRow> = {};
    for (const s of SEMS) init[s.key] = { absent: 0, lateEtc: 0 };
    return init;
  });

  // 엑셀 업로드
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadMsg, setUploadMsg] = useState<string>("");

  // 자유학기 유효성 (검정고시 제외)
  const freeSemValidWithinOneYear = useMemo(() => {
    if (atype === "검정고시") return true;
    const selected = Object.keys(freeSem).filter(
      (k) => freeSem[k] && baseWeight(track, atype, k) > 0
    );
    if (selected.length === 0) return true;
    const years = new Set<number>();
    for (const k of selected) {
      const m = SEMS.find((s) => s.key === k);
      if (m) years.add(m.year);
    }
    return years.size <= 1;
  }, [freeSem, track, atype]);

  // 학기 평균
  function semStats(semKey: string) {
    const rows = subs[semKey] || [];
    let cnt = 0,
      num = 0,
      den = 0;
    for (const r of rows) {
      const p = mapGradeToPoint(r.grade);
      if (p == null) continue;
      num += p;
      den += 1;
      cnt += 1;
    }
    const avg = den === 0 ? 0 : num / den;
    return { count: cnt, avg };
  }

  // 실효 가중치(자유학기 반영; 검정고시 제외, 전 전형 공통)
  const effectiveWeights = useMemo(() => {
    const eff: Record<string, number> = {};
    for (const s of SEMS) eff[s.key] = baseWeight(track, atype, s.key);

    if (atype !== "검정고시") {
      // 규칙2: 같은 학년 한 학기만 자유 → 다른 학기에 연간 합계 몰아주기
      for (const year of [1, 2, 3]) {
        const yearSems = SEMS.filter(
          (s) => s.year === year && baseWeight(track, atype, s.key) > 0
        );
        if (yearSems.length === 0) continue;

        const baseYearTotal = yearSems.reduce(
          (a, s) => a + baseWeight(track, atype, s.key),
          0
        );
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

      // 규칙3: 학년 전체 자유 → 차상학년 이관
      const addToYear = (targetYear: number, addWeight: number) => {
        if (addWeight <= 0) return;
        const tSems = SEMS.filter(
          (s) => s.year === targetYear && baseWeight(track, atype, s.key) > 0
        );
        if (tSems.length === 0) return;

        const currentTotal = tSems.reduce((a, s) => a + eff[s.key], 0);
        if (currentTotal > 0) {
          for (const s of tSems) {
            const ratio = eff[s.key] / currentTotal;
            eff[s.key] += addWeight * ratio;
          }
        } else {
          const baseTotal = tSems.reduce(
            (a, s) => a + baseWeight(track, atype, s.key),
            0
          );
          for (const s of tSems) {
            const b = baseWeight(track, atype, s.key);
            eff[s.key] += addWeight * (b / baseTotal);
          }
        }
      };

      const yearEffTotal = (y: number) =>
        SEMS.filter(
          (s) => s.year === y && baseWeight(track, atype, s.key) > 0
        ).reduce((a, s) => a + eff[s.key], 0);

      const yearBaseTotal = (y: number) =>
        SEMS.filter(
          (s) => s.year === y && baseWeight(track, atype, s.key) > 0
        ).reduce((a, s) => a + baseWeight(track, atype, s.key), 0);

      if (yearEffTotal(1) === 0 && yearBaseTotal(1) > 0)
        addToYear(2, yearBaseTotal(1));
      if (yearEffTotal(2) === 0 && yearBaseTotal(2) > 0)
        addToYear(3, yearBaseTotal(2));
      if (yearEffTotal(3) === 0 && yearBaseTotal(3) > 0)
        addToYear(2, yearBaseTotal(3));
    }

    // 합계 보정: 일반=12, 특별=10
    const targetSum = track === "일반전형" ? 12 : 10;
    const currentSum = Object.values(eff).reduce((a, b) => a + b, 0);
    if (currentSum > 0 && Math.abs(currentSum - targetSum) > 1e-9) {
      const k = targetSum / currentSum;
      for (const k2 of Object.keys(eff)) eff[k2] *= k;
    }
    return eff;
  }, [track, atype, freeSem]);

  // 교과 점수
  const calcCourseScoreRegular = () => {
    let sum = 0;
    for (const s of SEMS) {
      const w = effectiveWeights[s.key];
      if (w <= 0) continue;
      const { avg } = semStats(s.key);
      sum += avg * w;
    }
    return sum; // 일반: 60, 특별: 50 스케일이 가중에 반영됨
  };
  const calcCourseScoreGED = () => {
    if (gedSubs.length === 0) return 0;
    const pts = gedSubs
      .filter((v) => Number.isFinite(v.score))
      .map((v) => scoreToPointGED(v.score));
    if (pts.length === 0) return 0;
    const avg = pts.reduce((a, b) => a + b, 0) / pts.length; // 1~5
    return avg * 20; // =100
  };

  // 출결(학기별 합산; 자유학기와 무관)
  const calcAttendance = () => {
    const considered = SEMS.filter((s) => baseWeight(track, atype, s.key) > 0);
    let a = 0,
      l = 0;
    for (const s of considered) {
      const row = attBySem[s.key] || { absent: 0, lateEtc: 0 };
      a += Math.max(0, Math.floor(row.absent || 0));
      l += Math.max(0, Math.floor(row.lateEtc || 0));
    }
    return track === "일반전형"
      ? Math.max(0, 40 - 6 * a - 2 * l)
      : Math.max(0, 50 - 9 * a - 3 * l);
  };

  // 합계
  const { courseScore, attScore, totalScore, courseMax, attMax } =
    useMemo(() => {
      if (atype === "검정고시") {
        const c = round3(calcCourseScoreGED());
        return {
          courseScore: c,
          attScore: 0,
          totalScore: c,
          courseMax: 100,
          attMax: 0,
        };
      } else {
        const cRaw = calcCourseScoreRegular();
        const c = round3(cRaw);
        const a = round3(calcAttendance());
        const t = round3(c + a);
        const courseMax = track === "일반전형" ? 60 : 50;
        const attMax = track === "일반전형" ? 40 : 50;
        return {
          courseScore: c,
          attScore: a,
          totalScore: t,
          courseMax,
          attMax,
        };
      }
    }, [atype, track, subs, freeSem, gedSubs, attBySem, effectiveWeights]);

  // UI 유틸
  const isSemDisabledForGrades = (semKey: string) => {
    if (atype === "검정고시") return true;
    const bw = baseWeight(track, atype, semKey);
    if (bw <= 0) return true; // 교과 비반영 학기
    if (freeSem[semKey]) return true; // 자유학기면 교과 입력 막기 (전 전형 공통)
    return false;
  };
  const updateRow = (semKey: string, idx: number, patch: Partial<SubjRow>) =>
    setSubs((prev) => {
      const list = [...(prev[semKey] || [])];
      list[idx] = { ...list[idx], ...patch };
      return { ...prev, [semKey]: list };
    });
  const addRow = (semKey: string) =>
    setSubs((prev) => ({
      ...prev,
      [semKey]: [...(prev[semKey] || []), { name: "", grade: "" }],
    }));
  const clearRows = (semKey: string) =>
    setSubs((prev) => ({ ...prev, [semKey]: [{ name: "", grade: "" }] }));
  const removeRow = (semKey: string, idx: number) =>
    setSubs((prev) => {
      const list = [...(prev[semKey] || [])];
      list.splice(idx, 1);
      if (list.length === 0) list.push({ name: "", grade: "" });
      return { ...prev, [semKey]: list };
    });
  const updateAtt = (semKey: string, patch: Partial<AttRow>) =>
    setAttBySem((prev) => {
      const row = prev[semKey] ?? { absent: 0, lateEtc: 0 };
      const next: AttRow = {
        absent: clampInt(patch.absent ?? row.absent),
        lateEtc: clampInt(patch.lateEtc ?? row.lateEtc),
      };
      return { ...prev, [semKey]: next };
    });

  // ---------- 엑셀 업로드 ----------
  const handleFilePick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const inputEl = e.currentTarget;
    const file = inputEl.files?.[0];
    if (!file) return;

    setUploadMsg("파일을 처리 중입니다…");

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });

      if (atype === "검정고시") {
        // 검정고시: 첫 시트 2열(과목/점수) 가정
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const newGed: { subject: string; score: number }[] = [];
        for (const r of rows) {
          const subject = String(r["과목명"] ?? r["과목"] ?? "").trim();
          const scoreRaw = r["점수(0-100)"] ?? r["점수"] ?? r["score"] ?? "";
          const score = Number(scoreRaw);
          if (!subject || !Number.isFinite(score)) continue;
          newGed.push({ subject, score: Math.max(0, Math.min(100, score)) });
        }
        setGedSubs(newGed);
        setUploadMsg(`검정고시 과목 ${newGed.length}건을 불러왔습니다.`);
      } else {
        // 재학생/졸업생: 그리드형 시트 파싱
        const sheet0 = wb.Sheets[wb.SheetNames[0]];
        const gridParsed = tryParseGridSheet(sheet0);
        if (gridParsed) {
          setSubs(gridParsed);
          setUploadMsg(`그리드 템플릿에서 교과 ${countRows(gridParsed)}건을 불러왔습니다.`);
        } else {
          setUploadMsg("파일 형식을 인식할 수 없습니다. 그리드 템플릿을 사용해주세요.");
        }
      }
    } catch (err) {
      setUploadMsg(`오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`);
    }
  };

  // 그리드 시트 파싱 (B5:M25)
  const tryParseGridSheet = (sheet: any) => {
    const out: Record<string, SubjRow[]> = {};
    for (const s of SEMS) out[s.key] = [];

    // B5:M25 영역 파싱
    for (let r = 5; r <= 25; r++) {
      for (let c = 1; c <= 12; c += 2) { // B, D, F, H, J, L (과목명 열)
        const colName = String.fromCharCode(66 + c - 1); // B=66
        const gradeColName = String.fromCharCode(66 + c); // C, E, G, I, K, M
        const addr = `${colName}${r}`;
        const gradeAddr = `${gradeColName}${r}`;
        
        const name = String(sheet[addr]?.v ?? "").trim();
        const grade = String(sheet[gradeAddr]?.v ?? "").trim();
        
        if (name && grade) {
          const semIndex = Math.floor(c / 2);
          const semKey = SEMS[semIndex]?.key;
          if (semKey) {
            out[semKey].push({ name, grade });
          }
        }
      }
    }

    // 빈 학기는 기본값으로 채우기
    for (const s of SEMS) {
      if (out[s.key].length === 0) {
        out[s.key] = [{ name: "", grade: "" }];
      }
    }

    return out;
  };

  const countRows = (obj: Record<string, SubjRow[]>) =>
    Object.values(obj).reduce((a, b) => a + b.length, 0);

  // 템플릿 다운로드(ExcelJS, 단일 시트/그리드형)
  const downloadGridTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");

    // 열 너비
    const allCols = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"];
    const widths: Record<string, number> = {
      B: 18, C: 10, D: 18, E: 10, F: 18, G: 10, H: 18, I: 10, J: 18, K: 10, L: 18, M: 10,
    };
    allCols.forEach((col) => (ws.getColumn(col).width = widths[col]));

    // 공통 스타일
    const center = { vertical: "middle", horizontal: "center" } as const;
    const bold = { bold: true } as const;
    const white = { argb: "FFFFFFFF" };
    const black = { argb: "FF000000" };

    // 타이틀 병합
    ws.mergeCells("B2:E2");
    ws.getCell("B2").value = "1학년";
    ws.mergeCells("F2:I2");
    ws.getCell("F2").value = "2학년";
    ws.mergeCells("J2:M2");
    ws.getCell("J2").value = "3학년";

    // 타이틀 색상
    ws.getCell("B2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F81BD" } };
    ws.getCell("B2").font = { ...bold, color: white };
    ws.getCell("F2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD966" } };
    ws.getCell("F2").font = { ...bold, color: black };
    ws.getCell("J2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFA9D18E" } };
    ws.getCell("J2").font = { ...bold, color: black };
    ws.getCell("B2").alignment = center;
    ws.getCell("F2").alignment = center;
    ws.getCell("J2").alignment = center;

    // 학기 병합 라벨
    ([
      ["B3:C3", "1학년 1학기"],
      ["D3:E3", "1학년 2학기"],
      ["F3:G3", "2학년 1학기"],
      ["H3:I3", "2학년 2학기"],
      ["J3:K3", "3학년 1학기"],
      ["L3:M3", "3학년 2학기"],
    ] as const).forEach(([rng, label]) => {
      ws.mergeCells(rng);
      const cell = ws.getCell(rng.split(":")[0]);
      cell.value = label;
      cell.font = bold;
      cell.alignment = center;
    });

    // 헤더 라인
    ([
      ["B4", "과목명"], ["C4", "등급"], ["D4", "과목명"], ["E4", "등급"],
      ["F4", "과목명"], ["G4", "등급"], ["H4", "과목명"], ["I4", "등급"],
      ["J4", "과목명"], ["K4", "등급"], ["L4", "과목명"], ["M4", "등급"],
    ] as const).forEach(([addr, text]) => {
      const c = ws.getCell(addr);
      c.value = text;
      c.font = bold;
      c.alignment = center;
    });

    // 전체 테두리
    for (let r = 2; r <= 25; r++) {
      for (const col of allCols) {
        const cell = ws.getCell(`${col}${r}`);
        cell.border = {
          top: { style: "thin", color: { argb: "FFADB5BD" } },
          left: { style: "thin", color: { argb: "FFADB5BD" } },
          bottom: { style: "thin", color: { argb: "FFADB5BD" } },
          right: { style: "thin", color: { argb: "FFADB5BD" } },
        };
      }
    }

    // 외곽 thick 테두리
    const outerColor = { argb: "FF111827" };
    const leftCol = "B", rightCol = "M", topRow = 2, bottomRow = 25;
    const patchBorder = (addr: string, patch: any) => {
      const cell = ws.getCell(addr);
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
    const gradeCols = ["C", "E", "G", "I", "K", "M"];
    const gradeList = ["A/수", "B/우", "C/미", "D/양", "E/가", "A/우수", "B/보통", "C/미흡"];
    
    for (const col of gradeCols) {
      for (let r = 5; r <= 25; r++) {
        const cell = ws.getCell(`${col}${r}`);
        (cell as any).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [gradeList.join(",")],
        };
      }
    }

    // 파일 다운로드
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "대구일마이스터고_교과성적_입력템플릿.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- 렌더 ----------
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
  --col-grade-width: 220px; --col-action-width: 72px;
}
.page{
  width:960px; min-width:960px; max-width:960px; margin:0 auto;
  color: var(--gray-900); background: var(--white);
  min-height:100vh; padding:28px;
  font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial;
  font-size:14px;
}
h1{ font-size:16px; font-weight:800; margin:0 0 10px }
h3{ font-size:16px; font-weight:700; margin:0 0 10px }
.muted{ font-size:12px; color: var(--gray-500); line-height:1.6 }
.kpi{ font-size:16px; font-weight:800 }
.stack{ display:flex; gap:20px; flex-wrap:wrap }
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
.ui-select{
  background-image: linear-gradient(45deg, transparent 50%, var(--gray-600) 50%), linear-gradient(135deg, var(--gray-600) 50%, transparent 50%), linear-gradient(to right, transparent, transparent);
  background-position: calc(100% - 18px) 55%, calc(100% - 13px) 55%, 100% 0;
  background-size: 5px 5px, 5px 5px, 2.5em 2.5em; background-repeat:no-repeat; padding-right: 36px;
}
input[type="radio"], input[type="checkbox"]{ accent-color:#22c55e }
.btn{ border:1px solid var(--gray-300); background:var(--white); border-radius:var(--radius-sm); padding:8px 10px; cursor:pointer; font-size:14px }
.btn:hover{ background: var(--gray-80) }
.btn:disabled{ background: var(--gray-100); color: var(--gray-400); border-color: var(--gray-200); cursor:not-allowed }
.pill{ display:inline-flex; gap:6px; align-items:center; padding:6px 10px; border:1px solid var(--gray-300); border-radius:999px; background:var(--white); font-size:14px }
.dim{ opacity:.55 }
.year-block{ margin-top:12px }
.year-title{ font-size:14px; color: var(--gray-600); font-weight:700; margin: 6px 2px }
.year-grid{ display:grid; grid-template-columns: 1fr 1fr; gap:12px } /* 학년별 2열 */
.sem-box{ border:1px solid var(--gray-200); border-radius:10px; overflow:hidden }
.sem-head{ display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 10px; background:var(--gray-50); border-bottom:1px solid var(--gray-200) }
.row-grid{ display:grid; grid-template-columns: minmax(0, 1fr) var(--col-grade-width) var(--col-action-width); gap:8px; align-items:center; }
.att-grid{ display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
        .att-meta{ font-size:12px; color:var(--gray-500); }
        .uploader{ display:flex; align-items:center; gap:12px; margin:20px 0; padding:16px; background:var(--gray-50); border-radius:8px; }
        .uploader small{ color:var(--gray-500); font-size:12px; }
`}</style>

      <button className="btn" onClick={onBack || (() => window.history.back())} style={{ marginBottom: "20px" }}>
        ← 목록으로
      </button>

      <h1>대구일마이스터고 1차 전형 모의 성적 계산기</h1>
      <div className="muted" style={{ margin: "10px 0" }}>
        • 본 계산기는 <b>1차 전형</b>만 대상으로 합니다. (2차 전형의
        면접/소양평가 등은 제외) <br />• <b>생활기록부 등재</b> 기준으로만
        인정하며, 출결 등 기준일은 <b>2025-09-30</b> (졸업생은 졸업일 기준)
        입니다. <br />• 음악·미술·체육 과목도 교과성적에 <b>반영</b>합니다.{" "}
        <b>P/F 과목은 입력하지 마세요</b> (반영 제외).
      </div>

      {/* 전형/유형 */}
      <section className="card" style={{ marginBottom: 16 }}>
        <h3>전형 · 지원 유형</h3>
        <div className="stack">
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>
              전형
            </div>
            {(["일반전형", "특별전형"] as TrackType[]).map((t) => (
              <label
                key={t}
                style={{
                  display: "inline-flex",
                  gap: 6,
                  alignItems: "center",
                  marginRight: 12,
                }}
              >
                <input
                  type="radio"
                  name="track"
                  checked={track === t}
                  onChange={() => setTrack(t)}
                />{" "}
                {t}
              </label>
            ))}
          </div>
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>
              지원 유형
            </div>
            {(["졸업예정자", "졸업생", "검정고시"] as ApplicantType[]).map(
              (t) => (
                <label
                  key={t}
                  style={{
                    display: "inline-flex",
                    gap: 6,
                    alignItems: "center",
                    marginRight: 12,
                  }}
                >
                  <input
                    type="radio"
                    name="atype"
                    checked={atype === t}
                    onChange={() => setAtype(t)}
                  />{" "}
                  {t}
                </label>
              )
            )}
          </div>
        </div>

        {/* 업로드/템플릿 */}
        <div className="uploader">
          <button className="btn" onClick={downloadGridTemplate}>샘플 엑셀 다운로드(그리드)</button>

          <input
            ref={fileInputRef}
            onChange={onFileChange}
            onError={() => setUploadMsg("파일을 읽을 수 없습니다.")}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: "none" }}
          />
          <button className="btn" onClick={handleFilePick}>엑셀 업로드</button>

          <small>
            단일 시트 그리드(B2~M25) 형식을 지원합니다.
          </small>
          {uploadMsg && <div className="muted">{uploadMsg}</div>}
        </div>
      </section>

      {/* 자유학기 유효성 경고 (전 전형 공통, 검정고시 제외) */}
      {atype !== "검정고시" && !freeSemValidWithinOneYear && (
        <div className="err">
          ⚠ 자유학기는 <b>한 학년 내에서만</b> 선택할 수 있습니다. 서로 다른
          학년을 동시에 선택할 수 없습니다.
        </div>
      )}

      {/* 교과 성적 입력 (검정고시 제외) */}
      {atype !== "검정고시" && (
        <section className="card" style={{ marginTop: 12, marginBottom: 16 }}>
          <h3>교과 성적 입력</h3>
          <div className="muted">
            과목을 직접 추가하세요. <b>P/F</b> 과목은 입력하지 않습니다. (등급
            미선택 시 자동 제외) <br />
            (5등급: A/수~E/가 · 3등급: A/우수~C/미흡)
          </div>

          {/* 자유학기 설정 (전 전형 공통) */}
          <div className="subcard" style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              자유학기 설정 (한 학년 내에서만 가능)
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {SEMS.map((s) => {
                const bw = baseWeight(track, atype, s.key);
                const disabled = bw <= 0; // 해당 조합에서 반영되지 않는 학기(예: 예정자 3-2)
                return (
                  <label
                    key={s.key}
                    className={`pill ${disabled ? "dim" : ""}`}
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={!!freeSem[s.key]}
                      onChange={(e) =>
                        setFreeSem((prev) => ({
                          ...prev,
                          [s.key]: e.target.checked,
                        }))
                      }
                    />
                    {s.key}
                  </label>
                );
              })}
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              한 학기만 자유학기면 같은 학년의 다른 학기에 <b>학년 전체 비중</b>
              을 몰아줍니다. 동일 학년 두 학기 모두 자유학기면 그 학년 비중을{" "}
              <b>차상학년</b>에 전부 이관합니다.
            </div>
          </div>

          {/* 학년별 2열 그리드 */}
          {[1, 2, 3].map((year) => (
            <div key={year} className="year-block">
              <div className="year-title">{year}학년</div>
              <div className="year-grid">
                {SEMS.filter((s) => s.year === year).map((s) => {
                  const bw = baseWeight(track, atype, s.key);
                  const disabledForGrades = isSemDisabledForGrades(s.key);
                  const rows = subs[s.key] || [];
                  const { count, avg } = semStats(s.key);
                  const effW = effectiveWeights[s.key] || 0;
                  const hideInputs = bw <= 0;

                  return (
                    <div
                      key={s.key}
                      className={`sem-box ${disabledForGrades ? "dim" : ""}`}
                    >
                      <div className="sem-head">
                        <div
                          style={{ display: "flex", flexDirection: "column" }}
                        >
                          <div
                            style={{
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                            }}
                          >
                            <strong>학기: {s.key}</strong>
                            <span className="muted">
                              기본 ×{round3(bw)} · 실효 ×{round3(effW)}
                            </span>
                          </div>
                          <div className="muted" style={{ marginTop: 4 }}>
                            반영 행: <b>{count}</b> · 평균 미리보기:{" "}
                            <b>{round3(avg).toFixed(3)}</b>
                          </div>
                        </div>
                        {/* 체크는 위의 '자유학기 설정' 블록에서 통합 관리 */}
                      </div>

                      {/* 입력 영역 */}
                      <div style={{ padding: 10 }}>
                        {/* 헤더 */}
                        <div
                          className="row-grid muted"
                          style={{ marginBottom: 4 }}
                        >
                          <div>과목명</div>
                          <div>등급(5·3등급)</div>
                          <div style={{ textAlign: "right" }}>행</div>
                        </div>

                        {/* 입력 행 */}
                        {rows.map((row, idx) => (
                          <div
                            key={idx}
                            className="row-grid"
                            style={{ marginBottom: 8 }}
                          >
                            <input
                              className="ui-input"
                              placeholder="예) 국어, 수학, 체육, 음악..."
                              value={row.name}
                              onChange={(e) =>
                                updateRow(s.key, idx, { name: e.target.value })
                              }
                              disabled={disabledForGrades || hideInputs}
                            />
                            <select
                              className="ui-select"
                              value={row.grade}
                              onChange={(e) =>
                                updateRow(s.key, idx, { grade: e.target.value })
                              }
                              disabled={disabledForGrades || hideInputs}
                            >
                              <option value="">—</option>
                              <optgroup label="5등급 (A/수~E/가)">
                                {GRADE_5.map((g) => (
                                  <option key={g.value} value={g.value}>
                                    {g.display}
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label="3등급 (A/우수~C/미흡)">
                                {GRADE_3.map((g) => (
                                  <option key={g.value} value={g.value}>
                                    {g.display}
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                            <div style={{ textAlign: "right" }}>
                              <button
                                className="btn"
                                onClick={() => removeRow(s.key, idx)}
                                disabled={disabledForGrades || hideInputs}
                              >
                                삭제
                              </button>
                            </div>
                          </div>
                        ))}

                        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                          <button
                            className="btn"
                            onClick={() => addRow(s.key)}
                            disabled={disabledForGrades || hideInputs}
                          >
                            과목 추가
                          </button>
                          <button
                            className="btn"
                            onClick={() => clearRows(s.key)}
                            disabled={disabledForGrades || hideInputs}
                          >
                            모두 지우기
                          </button>
                        </div>

                        <div className="muted" style={{ marginTop: 8 }}>
                          평균(1~5) = (등급점 평균). 등급을 선택하지 않은
                          행(또는 P/F)은 반영되지 않습니다.
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

      {/* 출결 (별도 섹션, 검정고시 제외) */}
      {atype !== "검정고시" && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3>출결</h3>
          <div className="muted">
            {track === "일반전형"
              ? "산식: 40 – (미인정 결석×6) – (미인정 지각/조퇴/결과×2) · 최저 0점"
              : "산식: 50 – (미인정 결석×9) – (미인정 지각/조퇴/결과×3) · 최저 0점"}
          </div>

          {[1, 2, 3].map((year) => (
            <div key={year} className="year-block">
              <div className="year-title">{year}학년</div>
              <div className="year-grid">
                {SEMS.filter((s) => s.year === year).map((s) => {
                  const disabled = baseWeight(track, atype, s.key) <= 0; // 반영 안 되는 학기 비활성
                  const att = attBySem[s.key] || { absent: 0, lateEtc: 0 };
                  return (
                    <div
                      key={s.key}
                      className={`sem-box ${disabled ? "dim" : ""}`}
                    >
                      <div className="sem-head">
                        <strong>학기: {s.key}</strong>
                        <span className="muted">
                          {disabled ? "해당 조합에서 출결 비반영" : "반영됨"}
                        </span>
                      </div>
                      <div style={{ padding: 10 }}>
                        <div className="att-grid">
                          <div>
                            <label className="att-meta">미인정 결석 일수</label>
                            <input
                              className="ui-input"
                              type="number"
                              min={0}
                              step={1}
                              value={att.absent}
                              onChange={(e) =>
                                updateAtt(s.key, {
                                  absent: e.target.valueAsNumber,
                                })
                              }
                              disabled={disabled}
                              style={{ marginTop: 4 }}
                            />
                          </div>
                          <div>
                            <label className="att-meta">
                              미인정 지각/조퇴/결과 횟수
                            </label>
                            <input
                              className="ui-input"
                              type="number"
                              min={0}
                              step={1}
                              value={att.lateEtc}
                              onChange={(e) =>
                                updateAtt(s.key, {
                                  lateEtc: e.target.valueAsNumber,
                                })
                              }
                              disabled={disabled}
                              style={{ marginTop: 4 }}
                            />
                          </div>
                        </div>
                        <div className="muted" style={{ marginTop: 6 }}>
                          입력값은 학기별로 합산하여 출결 점수를 계산합니다.
                          (자유학기 여부와 무관)
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

      {/* 검정고시 입력 (전용 섹션) */}
      {atype === "검정고시" && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3>검정고시 과목 점수 (과목명 / 0~100)</h3>
          <div className="muted">
            환산: 95~100→5, 90~95→4, 85~90→3, 80~85→2, 80미만→1 → 평균×20=100
          </div>

          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {gedSubs.map((item, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <input
                  className="ui-input"
                  placeholder="과목명"
                  value={item.subject}
                  onChange={(e) =>
                    setGedSubs((prev) =>
                      prev.map((v, idx) =>
                        idx === i ? { ...v, subject: e.target.value } : v
                      )
                    )
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
                        idx === i
                          ? {
                              ...v,
                              score: Math.min(
                                100,
                                Math.max(0, Number(e.target.value))
                              ),
                            }
                          : v
                      )
                    )
                  }
                  style={{ width: 160 }}
                />
                <button
                  className="btn"
                  onClick={() =>
                    setGedSubs((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  삭제
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              className="btn"
              onClick={() =>
                setGedSubs((prev) => [...prev, { subject: "", score: 0 }])
              }
            >
              과목 추가
            </button>
            <button className="btn" onClick={() => setGedSubs([])}>
              모두 지우기
            </button>
          </div>
        </section>
      )}

      {/* 결과 */}
      <section className="card">
        <h3>결과</h3>
        {atype !== "검정고시" ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 12,
              }}
            >
              <div className="card">
                <div className="muted">교과 성적 ({courseMax})</div>
                <div className="kpi">{courseScore.toFixed(3)}</div>
              </div>
              <div className="card">
                <div className="muted">출결 ({attMax})</div>
                <div className="kpi">{attScore.toFixed(3)}</div>
              </div>
              <div className="card">
                <div className="muted">총점 (100점 만점)</div>
                <div className="kpi" style={{ fontSize: 18 }}>
                  {totalScore.toFixed(3)}
                </div>
              </div>
            </div>

            {/* 가중치 표시(진단용) */}
            <div className="subcard" style={{ marginTop: 12 }}>
              <div className="muted" style={{ marginBottom: 6 }}>
                학기별 실효 가중치
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(6, 1fr)",
                  gap: 8,
                }}
              >
                {SEMS.map((s) => (
                  <div key={s.key} className="card" style={{ padding: 8 }}>
                    <div className="muted">{s.key}</div>
                    <div>×{round3(effectiveWeights[s.key] || 0)}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div className="card">
                <div className="muted">교과 성적 (100)</div>
                <div className="kpi" style={{ fontSize: 18 }}>
                  {courseScore.toFixed(3)}
                </div>
              </div>
              <div className="card">
                <div className="muted">총점 (100점 만점)</div>
                <div className="kpi" style={{ fontSize: 18 }}>
                  {totalScore.toFixed(3)}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

    </div>
  );
}
