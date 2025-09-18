import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";

/**
 * 대구반도체마이스터고 1차 전형 성적 계산기
 */

// 학기 메타(가중치 단위 합 = 20)
const SEMS = [
  { key: "1-1", weightStudent: 2, weightGraduate: 2, year: 1 },
  { key: "1-2", weightStudent: 2, weightGraduate: 2, year: 1 },
  { key: "2-1", weightStudent: 4, weightGraduate: 4, year: 2 },
  { key: "2-2", weightStudent: 4, weightGraduate: 4, year: 2 },
  { key: "3-1", weightStudent: 8, weightGraduate: 4, year: 3 },
  { key: "3-2", weightStudent: 0, weightGraduate: 4, year: 3 }, // 재학생은 3-2 미반영
] as const;

type ApplicantType = "재학생" | "졸업생" | "검정고시";

const GRADE_PAIRED_OPTIONS = [
  { value: "A/수", display: "A/수" },
  { value: "B/우", display: "B/우" },
  { value: "C/미", display: "C/미" },
  { value: "D/양", display: "D/양" },
  { value: "E/가", display: "E/가" },
] as const;

function mapGradeToPoint(v?: string | null) {
  const t = (v || "").trim();
  const map: Record<string, number> = {
    "A/수": 5,
    "B/우": 4,
    "C/미": 3,
    "D/양": 2,
    "E/가": 1,
    A: 5,
    B: 4,
    C: 3,
    D: 2,
    E: 1,
    수: 5,
    우: 4,
    미: 3,
    양: 2,
    가: 1,
  };
  if (!t) return null;
  return map[t] ?? null;
}

function round3(x: number) {
  return Math.round((x + Number.EPSILON) * 1000) / 1000;
}

// 검정고시 환산: [95~100=5, 90~95=4, 85~90=3, 80~85=2, 80미만=1]
function scoreToPointGED(s: number) {
  if (s >= 95) return 5;
  if (s >= 90) return 4;
  if (s >= 85) return 3;
  if (s >= 80) return 2;
  return 1;
}

// 재/졸 과목 입력 행
type StdSubj = {
  name: string;
  grade: string;
  mathSci: boolean; // 수학/과학 1.5배
};

const BANNED_SUBJECT_KEYWORDS = ["음악", "미술", "체육"];

interface SemiconductorCalculatorProps {
  onBack?: () => void;
}

export default function SemiconductorCalculator({ onBack }: SemiconductorCalculatorProps) {
  const [atype, setAtype] = useState<ApplicantType>("재학생");

  // 재학생/졸업생: 학기별 과목 리스트(동적)
  const [stdSubs, setStdSubs] = useState<Record<string, StdSubj[]>>(() => {
    const init: Record<string, StdSubj[]> = {};
    for (const sem of SEMS) {
      init[sem.key] = [{ name: "", grade: "", mathSci: false }];
    }
    return init;
  });

  // 자유학기 체크
  const [freeSem, setFreeSem] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const sem of SEMS) init[sem.key] = false;
    return init;
  });

  // 검정고시 과목
  const [gedSubjects, setGedSubjects] = useState<
    { subject: string; score: number }[]
  >([]);

  // 학기별 출결
  const [attBySem, setAttBySem] = useState<Record<string, { absent: number; lateEtc: number }>>(() => {
    const init: Record<string, { absent: number; lateEtc: number }> = {};
    for (const s of SEMS) init[s.key] = { absent: 0, lateEtc: 0 };
    return init;
  });

  // 봉사
  const [vol1Hours, setVol1Hours] = useState<number>(0);
  const [vol2Hours, setVol2Hours] = useState<number>(0);
  const [vol3Hours, setVol3Hours] = useState<number>(0);

  const [vol1Year, setVol1Year] = useState<number>(2025);
  const [vol2Year, setVol2Year] = useState<number>(2025);
  const [vol3Year, setVol3Year] = useState<number>(2025);

  // 엑셀 업로드
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadMsg, setUploadMsg] = useState<string>("");

  // 가산점
  const [leadership, setLeadership] = useState<Record<string, boolean>>(() => {
    const obj: Record<string, boolean> = {};
    for (const sem of SEMS) obj[sem.key] = false;
    return obj;
  });
  const [careerExp, setCareerExp] = useState<boolean>(false);
  const [awardsCount, setAwardsCount] = useState<number>(0);

  // 재학생의 3-1 자유학기 특수 처리
  const hasStudent3_1OnlyFree =
    atype === "재학생" && freeSem["3-1"] && !freeSem["3-2"];

  // 자유학기 유효성 검사
  const validateFreeSemesterAcrossYears = () => {
    const selected = Object.keys(freeSem).filter((k) => freeSem[k]);
    if (selected.length === 0) return true;
    const byYear: Record<number, string[]> = { 1: [], 2: [], 3: [] };
    for (const k of selected) {
      const sem = SEMS.find((s) => s.key === k);
      if (sem) byYear[sem.year].push(k);
    }
    const activeYears = Object.keys(byYear).filter(
      (y) => byYear[Number(y)].length > 0
    );
    return activeYears.length <= 1;
  };

  // 학기 평균/요약 계산
  const rowIsBanned = (name: string) =>
    BANNED_SUBJECT_KEYWORDS.some((kw) => (name || "").trim().includes(kw));

  function semStats(semKey: string) {
    const rows = stdSubs[semKey] || [];
    let weightedCount = 0;
    let includedRowCount = 0;
    let num = 0;
    let den = 0;

    for (const row of rows) {
      const name = (row.name || "").trim();
      const banned = rowIsBanned(name);
      const p = mapGradeToPoint(row.grade);

      if (banned || p == null) continue;

      const w = row.mathSci ? 1.5 : 1;
      num += p * w;
      den += w;

      weightedCount += w;
      includedRowCount += 1;
    }

    const avg = den === 0 ? 0 : num / den;
    return { weightedCount, includedRowCount, avg };
  }

  // 실효 가중치 계산
  const effectiveWeights = useMemo(() => {
    const eff: Record<string, number> = {};
    for (const sem of SEMS) {
      eff[sem.key] =
        atype === "재학생" ? sem.weightStudent : sem.weightGraduate;
    }

    const freeMark: Record<string, boolean> = { ...freeSem };
    if (hasStudent3_1OnlyFree) freeMark["3-2"] = true;

    // 학년 내 한 학기만 자유학기 → 다른 학기에 몰아주기
    for (const year of [1, 2, 3]) {
      const yearSems = SEMS.filter((s) => s.year === year);
      const baseYearTotal = yearSems.reduce(
        (acc, s) =>
          acc + (atype === "재학생" ? s.weightStudent : s.weightGraduate),
        0
      );
      const freeCount = yearSems.filter((s) => freeMark[s.key]).length;
      if (freeCount === 1) {
        const kept = yearSems.find((s) => !freeMark[s.key]);
        const freed = yearSems.find((s) => freeMark[s.key]);
        if (kept && freed) {
          eff[freed.key] = 0;
          eff[kept.key] = baseYearTotal;
        }
      } else if (freeCount >= 2) {
        for (const s of yearSems) eff[s.key] = 0;
      }
    }

    // 한 학년 전체 자유학기 → 차상학년에 이관
    const addToYear = (targetYear: number, addWeight: number) => {
      if (addWeight <= 0) return;
      const targetSems = SEMS.filter((s) => s.year === targetYear);
      const currentTotal = targetSems.reduce((acc, s) => acc + eff[s.key], 0);
      if (currentTotal <= 0) {
        const baseTotal = targetSems.reduce(
          (acc, s) =>
            acc + (atype === "재학생" ? s.weightStudent : s.weightGraduate),
          0
        );
        for (const s of targetSems) {
          const b = atype === "재학생" ? s.weightStudent : s.weightGraduate;
          eff[s.key] += addWeight * (b / baseTotal);
        }
      } else {
        for (const s of targetSems) {
          const ratio = eff[s.key] / currentTotal;
          eff[s.key] += addWeight * ratio;
        }
      }
    };

    const yearIsAllFree = (y: number) =>
      SEMS.filter((s) => s.year === y).every((s) => eff[s.key] === 0);
    const yearBaseTotal = (y: number) =>
      SEMS.filter((s) => s.year === y).reduce(
        (acc, s) =>
          acc + (atype === "재학생" ? s.weightStudent : s.weightGraduate),
        0
      );

    if (yearIsAllFree(1)) addToYear(2, yearBaseTotal(1));
    if (yearIsAllFree(2)) addToYear(3, yearBaseTotal(2));
    if (yearIsAllFree(3)) addToYear(2, yearBaseTotal(3));

    // 합계 20으로 보정
    const total = Object.values(eff).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 20) > 1e-9) {
      const scale = 20 / (total || 1);
      for (const k of Object.keys(eff)) eff[k] *= scale;
    }
    return eff;
  }, [atype, freeSem, hasStudent3_1OnlyFree]);

  // 교과 점수 계산
  const calcCourseScoreRegular = () => {
    let sum = 0;
    for (const sem of SEMS) {
      const w = effectiveWeights[sem.key];
      if (w <= 0) continue;
      const { avg } = semStats(sem.key);
      sum += avg * w;
    }
    return sum;
  };

  const calcCourseScoreGED = () => {
    if (gedSubjects.length === 0) return 0;
    const pts = gedSubjects
      .filter((v) => Number.isFinite(v.score))
      .map((v) => scoreToPointGED(v.score));
    if (pts.length === 0) return 0;
    const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
    return avg * 20;
  };

  // 출결 계산 (학기별 합산)
  const calcAttendance = () => {
    const considered = SEMS.filter((s) => 
      atype === "재학생" ? s.weightStudent > 0 : s.weightGraduate > 0
    );
    let a = 0, l = 0;
    for (const s of considered) {
      const row = attBySem[s.key] || { absent: 0, lateEtc: 0 };
      a += Math.max(0, Math.floor(row.absent || 0));
      l += Math.max(0, Math.floor(row.lateEtc || 0));
    }
    const score = 46 - 6 * a - 2 * l;
    return Math.max(0, score);
  };

  // 봉사 계산
  const volScoreStudentPerYear = (h: number) => {
    const v = Math.max(0, Number(h) || 0);
    if (v >= 10) return 3;
    if (v >= 7) return 2;
    return 1;
  };
  const volScoreGraduatePerYear = (h: number, y: number) => {
    const v = Math.max(0, Number(h) || 0);
    if (y >= 2023) {
      if (v >= 10) return 3;
      if (v >= 7) return 2;
      return 1;
    } else if (y >= 2021) {
      if (v >= 5) return 3;
      if (v >= 3) return 2;
      return 1;
    }
    return 3;
  };
  const calcVolunteer = () => {
    if (atype === "재학생") {
      const s =
        volScoreStudentPerYear(vol1Hours) +
        volScoreStudentPerYear(vol2Hours) +
        volScoreStudentPerYear(vol3Hours);
      return Math.min(9, s);
    } else {
      const s =
        volScoreGraduatePerYear(vol1Hours, vol1Year) +
        volScoreGraduatePerYear(vol2Hours, vol2Year) +
        volScoreGraduatePerYear(vol3Hours, vol3Year);
      return Math.min(9, s);
    }
  };

  // 가산점 계산
  const calcBonusLeadership = () => {
    let cnt = 0;
    for (const sem of SEMS) {
      const active = atype === "재학생" ? sem.key !== "3-2" : true;
      if (leadership[sem.key] && active) cnt += 1;
    }
    return Math.min(6, cnt * 2);
  };
  const calcBonusCareer = () => (careerExp ? 3 : 0);
  const calcBonusAwards = () =>
    Math.min(6, Math.max(0, Math.floor(awardsCount)) * 2);

  // 합계 산출
  const {
    courseScore,
    attScore,
    volScore,
    bonusLeadership,
    bonusCareer,
    bonusAwards,
    totalScore,
  } = useMemo(() => {
    if (atype === "검정고시") {
      const c = round3(calcCourseScoreGED());
      return {
        courseScore: c,
        attScore: 0,
        volScore: 0,
        bonusLeadership: 0,
        bonusCareer: 0,
        bonusAwards: 0,
        totalScore: c,
      };
    } else {
      const c = round3(calcCourseScoreRegular());
      const a = round3(calcAttendance());
      const v = round3(calcVolunteer());
      const bl = round3(calcBonusLeadership());
      const bc = round3(calcBonusCareer());
      const ba = round3(calcBonusAwards());
      const t = round3(c + a + v + bl + bc + ba);
      return {
        courseScore: c,
        attScore: a,
        volScore: v,
        bonusLeadership: bl,
        bonusCareer: bc,
        bonusAwards: ba,
        totalScore: t,
      };
    }
  }, [
    atype,
    stdSubs,
    freeSem,
    gedSubjects,
    attBySem,
    vol1Hours,
    vol2Hours,
    vol3Hours,
    vol1Year,
    vol2Year,
    vol3Year,
    leadership,
    careerExp,
    awardsCount,
    effectiveWeights,
  ]);

  // UI 제어
  const isSemDisabled = (semKey: string) => {
    if (freeSem[semKey]) return true;
    if (atype === "재학생" && semKey === "3-2") return true;
    return false;
  };

  const addRow = (semKey: string) => {
    setStdSubs((prev) => ({
      ...prev,
      [semKey]: [
        ...(prev[semKey] || []),
        { name: "", grade: "", mathSci: false },
      ],
    }));
  };

  const clearRows = (semKey: string) => {
    setStdSubs((prev) => ({
      ...prev,
      [semKey]: [{ name: "", grade: "", mathSci: false }],
    }));
  };

  const updateRow = (semKey: string, idx: number, patch: Partial<StdSubj>) => {
    setStdSubs((prev) => {
      const list = [...(prev[semKey] || [])];
      list[idx] = { ...list[idx], ...patch };
      return { ...prev, [semKey]: list };
    });
  };

  const removeRow = (semKey: string, idx: number) => {
    setStdSubs((prev) => {
      const list = [...(prev[semKey] || [])];
      list.splice(idx, 1);
      if (list.length === 0) list.push({ name: "", grade: "", mathSci: false });
      return { ...prev, [semKey]: list };
    });
  };

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
        setGedSubjects(newGed);
        setUploadMsg(`검정고시 과목 ${newGed.length}건을 불러왔습니다.`);
      } else {
        // 재학생/졸업생: 그리드형 시트 파싱
        const sheet0 = wb.Sheets[wb.SheetNames[0]];
        const gridParsed = tryParseGridSheet(sheet0);
        if (gridParsed) {
          setStdSubs(gridParsed);
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
    const out: Record<string, { name: string; grade: string; mathSci: boolean }[]> = {};
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
            out[semKey].push({ name, grade, mathSci: false });
          }
        }
      }
    }

    // 빈 학기는 기본값으로 채우기
    for (const s of SEMS) {
      if (out[s.key].length === 0) {
        out[s.key] = [{ name: "", grade: "", mathSci: false }];
      }
    }

    return out;
  };

  const countRows = (obj: Record<string, { name: string; grade: string; mathSci: boolean }[]>) =>
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
    a.download = "대구반도체마이스터고_교과성적_입력템플릿.xlsx";
    a.click();
    URL.revokeObjectURL(url);
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
        .pill{ display:inline-flex; gap:6px; align-items:center; padding:6px 10px; border:1px solid var(--gray-300); border-radius:999px; background:var(--white); font-size:14px }
        .dim{ opacity:.55 }
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
        .row-grid{ display:grid; grid-template-columns: 2fr 1fr 1fr auto; gap:8px; align-items:center; }
        .grid-2{ display:grid; grid-template-columns: repeat(2, 1fr); gap:12px; }
        .grid-3{ display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; }
        .grid-6{ display:grid; grid-template-columns: repeat(6, 1fr); gap:12px; }
        .badge-muted{ font-size:12px; color: var(--gray-500) }
        .year-block{ margin-top:12px }
        .year-title{ font-size:14px; color: var(--gray-600); font-weight:700; margin: 6px 2px }
        .year-grid{ display:grid; grid-template-columns: 1fr 1fr; gap:12px }
        .att-grid{ display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
        .att-meta{ font-size:12px; color:var(--gray-500); }
        .uploader{ display:flex; align-items:center; gap:12px; margin:20px 0; padding:16px; background:var(--gray-50); border-radius:8px; }
        .uploader small{ color:var(--gray-500); font-size:12px; }
        input[type="radio"], input[type="checkbox"]{ accent-color:#22c55e }
      `}</style>

      <button className="btn" onClick={onBack || (() => window.history.back())} style={{ marginBottom: "20px" }}>
        ← 목록으로
      </button>

      <h1>대구반도체마이스터고 1차 전형 성적 계산기</h1>
      <div className="muted" style={{ margin: "10px 0" }}>
        • 본 계산기는 <b>1차 전형</b>만 대상으로 합니다. (2차 전형의
        면접/소양평가 등은 제외) <br />• 출결/봉사/가산점 기준일:{" "}
        <b>2025-09-30</b> (졸업생은 졸업일 기준). 모든 항목은{" "}
        <b>생활기록부 등재</b> 기준으로만 인정됩니다. <br />•{" "}
        <b>음악·미술·체육은 입력하지 마세요</b> (자동 제외/경고). 수학·과학은{" "}
        <b>체크</b>하여 ×1.5 가중합니다. P/F 과목은 입력하지 않습니다.
      </div>

      {/* 자유학기 유효성 경고 */}
      {!validateFreeSemesterAcrossYears() && (
        <div className="err" style={{ marginBottom: 8 }}>
          ⚠ 자유학기는 <b>한 학년 내에서만</b> 선택할 수 있습니다. 학년을 넘어
          2개 학기를 동시에 선택할 수 없습니다.
        </div>
      )}
      {hasStudent3_1OnlyFree && (
        <div style={{ color: "#b45309", marginBottom: 8, fontSize: 12 }}>
          ℹ 재학생은 3-2 성적이 반영되지 않으므로 <b>3-1만 자유학기</b>로
          설정하면 3학년 전체 자유학기로 간주되어 40% 비중이 2학년에 이관됩니다.
        </div>
      )}

      {/* 지원 유형 */}
      <section className="card" style={{ marginBottom: 16 }}>
        <h3>지원 유형</h3>
        <div className="stack">
          {(["재학생", "졸업생", "검정고시"] as ApplicantType[]).map((t) => (
            <label
              key={t}
              style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
            >
              <input
                type="radio"
                name="atype"
                checked={atype === t}
                onChange={() => setAtype(t)}
              />{" "}
              {t}
            </label>
          ))}
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

      {/* 교과 성적 입력(재/졸: 동적 과목/등급) */}
      {atype !== "검정고시" && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3>교과 성적 입력 (재학생/졸업생)</h3>
          <div className="muted" style={{ marginBottom: 8 }}>
            과목은 직접 추가하세요. <b>음악/미술/체육</b>은 입력하지
            않습니다(자동 제외 경고). 수학/과학 과목은 체크해서 <b>1.5배</b>{" "}
            가중을 적용하세요.
          </div>

          <div className="grid-2">
            {SEMS.map((sem) => {
              const disabled = isSemDisabled(sem.key);
              const rows = stdSubs[sem.key] || [];
              const { weightedCount, includedRowCount, avg } = semStats(
                sem.key
              );

              return (
                <div
                  key={sem.key}
                  className={`sem-box ${disabled ? "dim" : ""}`}
                >
                  <div className="sem-head">
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <div
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                        }}
                      >
                        <strong>학기: {sem.key}</strong>
                        <span className="badge-muted">
                          실효 가중치 ×{round3(effectiveWeights[sem.key])}
                        </span>
                      </div>
                      <div className="badge-muted" style={{ marginTop: 4 }}>
                        반영 과목수(가중): <b>{round3(weightedCount)}</b> (행{" "}
                        {includedRowCount}개) · 평균 미리보기:{" "}
                        <b>{round3(avg).toFixed(3)}</b>
                      </div>
                    </div>
                    <label
                      style={{
                        display: "inline-flex",
                        gap: 6,
                        alignItems: "center",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!freeSem[sem.key]}
                        onChange={(e) =>
                          setFreeSem((prev) => ({
                            ...prev,
                            [sem.key]: e.target.checked,
                          }))
                        }
                      />{" "}
                      자유학기
                    </label>
                  </div>

                  <div style={{ padding: 10 }}>
                    <div
                      className="row-grid badge-muted"
                      style={{ marginBottom: 4 }}
                    >
                      <div>과목명</div>
                      <div>수학/과학(×1.5)</div>
                      <div>등급</div>
                      <div style={{ textAlign: "right" }}>행</div>
                    </div>

                    {rows.map((row, idx) => {
                      const banned = rowIsBanned(row.name);
                      return (
                        <div
                          key={idx}
                          className="row-grid"
                          style={{
                            alignItems: "center",
                            marginBottom: 8,
                          }}
                        >
                          <div>
                            <input
                              className="ui-input"
                              type="text"
                              placeholder="예) 수학, 과학, 국어, 역사... (음악/미술/체육 입력 금지)"
                              value={row.name}
                              onChange={(e) =>
                                updateRow(sem.key, idx, {
                                  name: e.target.value,
                                })
                              }
                              disabled={disabled}
                              style={{
                                border: banned
                                  ? "1px solid #ef4444"
                                  : undefined,
                              }}
                            />
                            {banned && (
                              <div
                                style={{
                                  color: "#ef4444",
                                  fontSize: 11,
                                  marginTop: 4,
                                }}
                              >
                                ⛔ 음악/미술/체육 과목은 반영하지 않습니다(자동
                                제외).
                              </div>
                            )}
                          </div>

                          <div>
                            <label
                              style={{
                                display: "inline-flex",
                                gap: 6,
                                alignItems: "center",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={row.mathSci}
                                onChange={(e) =>
                                  updateRow(sem.key, idx, {
                                    mathSci: e.target.checked,
                                  })
                                }
                                disabled={disabled}
                              />
                              적용
                            </label>
                          </div>

                          <div>
                            <select
                              className="ui-select"
                              value={row.grade}
                              onChange={(e) =>
                                updateRow(sem.key, idx, {
                                  grade: e.target.value,
                                })
                              }
                              disabled={disabled}
                            >
                              <option value="">—</option>
                              {GRADE_PAIRED_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.display}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div style={{ textAlign: "right" }}>
                            <button
                              className="btn"
                              onClick={() => removeRow(sem.key, idx)}
                              disabled={disabled}
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      <button
                        className="btn"
                        onClick={() => addRow(sem.key)}
                        disabled={disabled}
                      >
                        과목 추가
                      </button>
                      <button
                        className="btn"
                        onClick={() => clearRows(sem.key)}
                        disabled={disabled}
                      >
                        모두 지우기
                      </button>
                    </div>

                    <div className="badge-muted" style={{ marginTop: 8 }}>
                      평균(1~5) = (가중합 ÷ 가중수).{" "}
                      <b>수학/과학 체크 시 ×1.5</b>, 음악·미술·체육은 반영 제외.
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 검정고시 입력 */}
      {atype === "검정고시" && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3>검정고시 과목 점수 (과목명 / 0~100)</h3>
          <div className="muted">
            환산: 95~100→5, 90~95→4, 85~90→3, 80~85→2, 80미만→1 →
            평균×20(=100점)
          </div>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {gedSubjects.map((item, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <input
                  className="ui-input"
                  type="text"
                  placeholder="과목명"
                  value={item.subject}
                  onChange={(e) =>
                    setGedSubjects((prev) =>
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
                    setGedSubjects((prev) =>
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
                  style={{ width: 110 }}
                />
                <button
                  className="btn"
                  onClick={() =>
                    setGedSubjects((prev) => prev.filter((_, idx) => idx !== i))
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
                setGedSubjects((prev) => [...prev, { subject: "", score: 0 }])
              }
            >
              과목 추가
            </button>
            <button className="btn" onClick={() => setGedSubjects([])}>
              모두 지우기
            </button>
          </div>
        </section>
      )}

      {/* 출결 (별도 섹션, 검정고시 제외) */}
      {atype !== "검정고시" && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3>출결</h3>
          <div className="muted">
            산식: 46 – (미인정 결석×6) – (미인정 지각/조퇴/결과×2) · 최저 0점
          </div>

          {[1, 2, 3].map((year) => (
            <div key={year} className="year-block">
              <div className="year-title">{year}학년</div>
              <div className="year-grid">
                {SEMS.filter((s) => s.year === year).map((s) => {
                  const disabled = atype === "재학생" ? s.weightStudent <= 0 : s.weightGraduate <= 0;
                  const att = attBySem[s.key] || { absent: 0, lateEtc: 0 };
                  return (
                    <div
                      key={s.key}
                      className={`sem-box ${disabled ? "dim" : ""}`}
                    >
                      <div className="sem-head">
                        <strong>학기: {s.key}</strong>
                        <span className="muted">
                          {disabled ? "해당 유형에서 출결 비반영" : "반영됨"}
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
                                setAttBySem((prev) => ({
                                  ...prev,
                                  [s.key]: {
                                    ...prev[s.key],
                                    absent: Math.max(0, Math.floor(Number(e.target.value) || 0))
                                  }
                                }))
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
                                setAttBySem((prev) => ({
                                  ...prev,
                                  [s.key]: {
                                    ...prev[s.key],
                                    lateEtc: Math.max(0, Math.floor(Number(e.target.value) || 0))
                                  }
                                }))
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

      {/* 봉사/가산점 */}
      {atype !== "검정고시" && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3>
            봉사활동 · 가산점 (2025-09-30 기준, 졸업생은 졸업일 기준)
          </h3>
          <div className="grid-2">

            {/* 봉사 */}
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                봉사 (최대 9점, 학년별 최대 3점)
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <div>
                  <label className="badge-muted">1학년 봉사시간</label>
                  <input
                    className="ui-input"
                    type="number"
                    min={0}
                    step={0.5}
                    value={vol1Hours}
                    onChange={(e) => setVol1Hours(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="badge-muted">1학년 실행년도(YYYY)</label>
                  <input
                    className="ui-input"
                    type="number"
                    min={2000}
                    max={2099}
                    step={1}
                    value={vol1Year}
                    onChange={(e) => setVol1Year(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label className="badge-muted">2학년 봉사시간</label>
                  <input
                    className="ui-input"
                    type="number"
                    min={0}
                    step={0.5}
                    value={vol2Hours}
                    onChange={(e) => setVol2Hours(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="badge-muted">2학년 실행년도(YYYY)</label>
                  <input
                    className="ui-input"
                    type="number"
                    min={2000}
                    max={2099}
                    step={1}
                    value={vol2Year}
                    onChange={(e) => setVol2Year(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label className="badge-muted">3학년 봉사시간</label>
                  <input
                    className="ui-input"
                    type="number"
                    min={0}
                    step={0.5}
                    value={vol3Hours}
                    onChange={(e) => setVol3Hours(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="badge-muted">3학년 실행년도(YYYY)</label>
                  <input
                    className="ui-input"
                    type="number"
                    min={2000}
                    max={2099}
                    step={1}
                    value={vol3Year}
                    onChange={(e) => setVol3Year(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                재학생: 실행년도 입력은 기록용이며{" "}
                <b>점수 계산에는 사용하지 않습니다</b>. 졸업생: 실행년도에 따라
                점수 기준이 달라집니다.
              </div>
            </div>
          </div>

          {/* 리더십/진로체험/모범상 */}
          <div className="grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                리더십 가산점 (최대 6점)
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {SEMS.map((sem) => {
                  const active = atype === "재학생" ? sem.key !== "3-2" : true;
                  return (
                    <label
                      key={sem.key}
                      className="pill"
                      style={{ opacity: active ? 1 : 0.5 }}
                    >
                      <input
                        type="checkbox"
                        checked={!!leadership[sem.key]}
                        disabled={!active}
                        onChange={(e) =>
                          setLeadership((prev) => ({
                            ...prev,
                            [sem.key]: e.target.checked,
                          }))
                        }
                      />
                      {sem.key}
                    </label>
                  );
                })}
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                전교 학생회장·부회장·학급반장만 인정(부반장 제외).{" "}
                <b>학기 전체</b> 수행 시 학기당 2점, 최대 6점.
              </div>
            </div>

            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                본교 진로체험 · 모범상
              </div>
              <label
                style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
              >
                <input
                  type="checkbox"
                  checked={careerExp}
                  onChange={(e) => setCareerExp(e.target.checked)}
                />
                본교 반도체 8대공정 체험/견학 <b>1회 이상 참여(3점)</b>
              </label>
              <div className="muted" style={{ margin: "4px 0 10px" }}>
                (예: 6/27, 9/5, 9/19, 10/17 중 1회 이상)
              </div>

              <label className="badge-muted">
                모범상 수상 횟수 (0~3회, 1회당 2점)
              </label>
              <input
                className="ui-input"
                type="number"
                min={0}
                max={3}
                step={1}
                value={awardsCount}
                onChange={(e) => setAwardsCount(Number(e.target.value))}
              />
              <div className="muted" style={{ marginTop: 6 }}>
                모범/선행/효행/공로/노력상 등 <b>교내</b> 수상만 인정, 최대 6점.
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 결과 */}
      <section className="card">
        <h3>결과</h3>
        {atype !== "검정고시" ? (
          <>
            <div className="grid-6">
              <div className="card">
                <div className="muted">교과 성적 (100)</div>
                <div className="kpi">{courseScore.toFixed(3)}</div>
              </div>
              <div className="card">
                <div className="muted">출결 (46)</div>
                <div className="kpi">{attScore.toFixed(3)}</div>
              </div>
              <div className="card">
                <div className="muted">봉사 (9)</div>
                <div className="kpi">{volScore.toFixed(3)}</div>
              </div>
              <div className="card">
                <div className="muted">리더십 (6)</div>
                <div className="kpi">{bonusLeadership.toFixed(3)}</div>
              </div>
              <div className="card">
                <div className="muted">진로체험 (3)</div>
                <div className="kpi">{bonusCareer.toFixed(3)}</div>
              </div>
              <div className="card">
                <div className="muted">모범상 (6)</div>
                <div className="kpi">{bonusAwards.toFixed(3)}</div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="muted">총점 (170점 만점)</div>
              <div className="kpi" style={{ fontSize: 18 }}>
                {totalScore.toFixed(3)}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="card">
              <div className="muted">교과 성적 (100)</div>
              <div className="kpi" style={{ fontSize: 18 }}>
                {courseScore.toFixed(3)}
              </div>
            </div>
            <div className="card" style={{ marginTop: 12 }}>
              <div className="muted">총점 (100점 만점)</div>
              <div className="kpi" style={{ fontSize: 18 }}>
                {totalScore.toFixed(3)}
              </div>
            </div>
          </>
        )}
      </section>

    </div>
  );
}
