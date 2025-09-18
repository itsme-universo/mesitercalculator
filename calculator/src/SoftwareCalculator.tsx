import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";

/**
 * 대구소프트웨어마이스터고등학교 1차 전형 모의 성적 계산기
 */

type ApplicantType = "재학생" | "졸업생" | "검정고시";

const SUBJECTS = [
  { key: "국어", w: 1 },
  { key: "수학", w: 2 }, // 2배 가중
  { key: "영어", w: 1 },
  { key: "사회", w: 1 },
  { key: "도덕", w: 1 },
  { key: "과학", w: 2 }, // 2배 가중
  { key: "역사", w: 1 },
  { key: "정보", w: 2 }, // 2배 가중
] as const;

const SEMS = [
  // key, 재학생 가중, 졸업생 가중, 학년
  { key: "1-1", weightStudent: 2, weightGraduate: 2, year: 1 },
  { key: "1-2", weightStudent: 2, weightGraduate: 2, year: 1 },
  { key: "2-1", weightStudent: 3, weightGraduate: 3, year: 2 },
  { key: "2-2", weightStudent: 3, weightGraduate: 3, year: 2 },
  { key: "3-1", weightStudent: 10, weightGraduate: 5, year: 3 },
  { key: "3-2", weightStudent: 0, weightGraduate: 5, year: 3 }, // 재학생은 3-2 미반영
] as const;

const GRADE_PAIRED_OPTIONS = [
  { value: "A/수", display: "A/수" },
  { value: "B/우", display: "B/우" },
  { value: "C/미", display: "C/미" },
  { value: "D/양", display: "D/양" },
  { value: "E/가", display: "E/가" },
] as const;

type GradesState = Record<string, Record<string, string>>;
type FreeSemesterState = Record<string, boolean>;
type LeadershipState = Record<string, boolean>;

interface GedSubject {
  subject: string;
  score: number;
}

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
  if (t === "" || t === "P" || t === "F") return null; // P/F 제외
  return map[t] ?? null;
}

function round3(x: number) {
  return Math.round((x + Number.EPSILON) * 1000) / 1000;
}

// 검정고시 환산: [98~100=5, 94~98=4, 90~94=3, 86~90=2, 86미만=1]
function scoreToPointGED(s: number) {
  if (s >= 98) return 5;
  if (s >= 94) return 4;
  if (s >= 90) return 3;
  if (s >= 86) return 2;
  return 1;
}

interface SoftwareCalculatorProps {
  onBack?: () => void;
}

export default function SoftwareCalculator({ onBack }: SoftwareCalculatorProps) {
  const [atype, setAtype] = useState<ApplicantType>("재학생");

  // 교과 성적
  const [grades, setGrades] = useState<GradesState>(() => {
    const init: GradesState = {};
    for (const sem of SEMS) {
      init[sem.key] = {} as Record<string, string>;
      for (const sub of SUBJECTS) init[sem.key][sub.key] = "";
    }
    return init;
  });

  // 자유학기 체크
  const [freeSem, setFreeSem] = useState<FreeSemesterState>(() => {
    const init: FreeSemesterState = {};
    for (const sem of SEMS) init[sem.key] = false;
    return init;
  });

  // 검정고시 과목(과목명/점수)
  const [gedSubjects, setGedSubjects] = useState<GedSubject[]>([]);

  // 학기별 출결
  const [attBySem, setAttBySem] = useState<Record<string, { absent: number; lateEtc: number }>>(() => {
    const init: Record<string, { absent: number; lateEtc: number }> = {};
    for (const s of SEMS) init[s.key] = { absent: 0, lateEtc: 0 };
    return init;
  });

  // 봉사 시간(학년별) 및 실행년도
  const [vol1, setVol1] = useState<number>(0);
  const [vol2, setVol2] = useState<number>(0);
  const [vol3, setVol3] = useState<number>(0);
  const [vol1Year, setVol1Year] = useState<string>("2024");
  const [vol2Year, setVol2Year] = useState<string>("2024");
  const [vol3Year, setVol3Year] = useState<string>("2024");

  // 엑셀 업로드
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadMsg, setUploadMsg] = useState<string>("");

  // 가산점
  const [leadership, setLeadership] = useState<LeadershipState>(() => {
    const obj: LeadershipState = {};
    for (const sem of SEMS) obj[sem.key] = false;
    return obj;
  });
  const [awardsCount, setAwardsCount] = useState<number>(0); // 0~2(+ 가능하나 캡 2)

  // ---------- 학기 평균(1~5) ----------
  const semesterAverage = (semKey: string) => {
    let num = 0,
      den = 0;
    for (const sub of SUBJECTS) {
      const val = grades[semKey]?.[sub.key] ?? "";
      const p = mapGradeToPoint(val);
      if (p == null) continue; // P/F/빈칸 제외
      num += p * sub.w;
      den += sub.w;
    }
    if (den === 0) return 0;
    return num / den; // 1~5
  };

  // ---------- 자유학기 유효성: 한 학년 내에서만 ----------
  const validateFreeOneYearOnly = () => {
    const picked = Object.keys(freeSem).filter((k) => freeSem[k]);
    if (picked.length === 0) return true;
    const byYear: Record<number, string[]> = { 1: [], 2: [], 3: [] };
    for (const k of picked) {
      const sem = SEMS.find((s) => s.key === k);
      if (sem) byYear[sem.year].push(k);
    }
    const activeYears = Object.keys(byYear).filter(
      (y) => byYear[Number(y)].length > 0
    );
    return activeYears.length <= 1; // 학년跨 금지
  };

  // 재학생의 3-1만 자유학기 체크 시 → 3학년 전체 없음 처리에 활용
  const studentOnly3_1Free =
    atype === "재학생" && freeSem["3-1"] && !freeSem["3-2"];

  // ---------- 실효 가중치 계산(기본합 20) + 자유학기 규칙 2/3 반영 ----------
  const effectiveWeights = useMemo(() => {
    const eff: Record<string, number> = {};
    for (const sem of SEMS) {
      eff[sem.key] =
        atype === "재학생" ? sem.weightStudent : sem.weightGraduate;
    }

    // 재학생: 3-1만 자유학기 → 3학년 전체 자유학기처럼 취급(3-2는 원천 0)
    const freeMark: FreeSemesterState = { ...freeSem };
    if (studentOnly3_1Free) freeMark["3-2"] = true;

    // 규칙2: 한 학기만 자유학기면, 남은 학기에 학년 전체 비중 몰아주기
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
      } else if (freeCount === 2) {
        // 규칙3 케이스(해당 학년 전체 자유학기) → 일단 0으로
        for (const s of yearSems) eff[s.key] = 0;
      }
    }

    // 합계가 20에서 오차 나면 정규화
    const total = Object.values(eff).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 20) > 1e-9) {
      const scale = 20 / (total || 1);
      for (const k of Object.keys(eff)) eff[k] *= scale;
    }
    return eff;
  }, [atype, freeSem, studentOnly3_1Free]);

  // ---------- 교과 점수(재/졸: 80점 만점) ----------
  const calcCourseScoreRegular = () => {
    // 가중합 (최대 100)
    let sum = 0;
    for (const sem of SEMS) {
      const w = effectiveWeights[sem.key];
      if (w <= 0) continue;
      const avg = semesterAverage(sem.key); // 1~5
      sum += avg * w; // w 합=20 → 최대 100
    }

    // 규칙3: 한 학년 전체 자유학기인 경우 → 보정계수 적용(한 학년만 가능하도록 유효성 검사)
    const yearAllZero = (year: number) =>
      SEMS.filter((s) => s.year === year).every(
        (s) => (effectiveWeights[s.key] || 0) === 0
      );

    let adjusted = sum;
    if (yearAllZero(1)) adjusted *= 100 / 80;
    if (yearAllZero(2)) adjusted *= 100 / 70;
    if (yearAllZero(3)) adjusted *= 100 / 50;

    // 80점 환산
    return adjusted * 0.8;
  };

  // ---------- 교과 점수(검정고시: 100점 만점) ----------
  const calcCourseScoreGED = () => {
    if (gedSubjects.length === 0) return 0;
    const pts = gedSubjects
      .filter((v) => Number.isFinite(v.score))
      .map((v) => scoreToPointGED(v.score));
    if (pts.length === 0) return 0;
    const avg = pts.reduce((a, b) => a + b, 0) / pts.length; // 1~5
    return avg * 20; // 100점
  };

  // ---------- 출결(10점) ----------
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
    const baseAbsent = a;
    const addAbsentFromLate = Math.floor(l / 3);
    const effectiveAbsent = Math.min(5, baseAbsent + addAbsentFromLate);
    const score = 10 - 2 * effectiveAbsent;
    return Math.max(0, score);
  };

  // ---------- 봉사(6점) ----------
  const perYearVolunteer = (h: number, year: string) => {
    const v = Math.max(0, Number(h) || 0);
    const y = Number(year) || 2024;
    const isRecent = y >= 2024; // 2024년 이후
    if (v >= 10) return isRecent ? 2.0 : 1.0;
    if (v >= 7) return isRecent ? 1.6 : 0.8;
    return isRecent ? 1.2 : 0.6; // <7 (0시간 포함)
  };
  const calcVolunteer = () => {
    const total =
      perYearVolunteer(vol1, vol1Year) + perYearVolunteer(vol2, vol2Year) + perYearVolunteer(vol3, vol3Year);
    return Math.min(6, total);
  };

  // ---------- 가산점(리더십/모범상) ----------
  const calcLeadership = () => {
    // 학기 체크 수 × 2점이 원칙이나, 본 계산기 총점 설계상 최대 2점으로 캡
    let cnt = 0;
    for (const sem of SEMS) {
      const active = atype === "재학생" ? sem.key !== "3-2" : true; // 재학생은 3-2 미인정
      if (leadership[sem.key] && active) cnt += 1;
    }
    return Math.min(2, cnt * 2); // 최대 2점
  };
  const calcAwards = () => Math.min(2, Math.max(0, Math.floor(awardsCount))); // 1회 1점, 최대 2

  // ---------- 합계 ----------
  const {
    courseScore,
    attScore,
    volScore,
    leaderScore,
    awardScore,
    totalScore,
  } = useMemo(() => {
    if (atype === "검정고시") {
      const c = round3(calcCourseScoreGED()); // 100
      return {
        courseScore: c,
        attScore: 0,
        volScore: 0,
        leaderScore: 0,
        awardScore: 0,
        totalScore: c, // 100
      };
    } else {
      const c = round3(calcCourseScoreRegular()); // 80
      const a = round3(calcAttendance()); // 10
      const v = round3(calcVolunteer()); // 6
      const l = round3(calcLeadership()); // 2
      const w = round3(calcAwards()); // 2
      const t = round3(c + a + v + l + w); // 100
      return {
        courseScore: c,
        attScore: a,
        volScore: v,
        leaderScore: l,
        awardScore: w,
        totalScore: t,
      };
    }
  }, [
    atype,
    grades,
    freeSem,
    gedSubjects,
    attBySem,
    vol1,
    vol2,
    vol3,
    vol1Year,
    vol2Year,
    vol3Year,
    leadership,
    awardsCount,
    effectiveWeights,
  ]);

  // ---------- UI 제어 ----------
  const isSemDisabled = (semKey: string) => {
    if (freeSem[semKey]) return true; // 자유학기면 입력 비활성
    if (atype === "재학생" && semKey === "3-2") return true; // 재학생: 3-2 미반영
    return false;
  };

  const setGrade = (semKey: string, subKey: string, val: string) => {
    setGrades((prev) => ({
      ...prev,
      [semKey]: { ...prev[semKey], [subKey]: val },
    }));
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
          setGrades(gridParsed);
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
    const out: Record<string, Record<string, string>> = {};
    for (const s of SEMS) out[s.key] = {};

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
            out[semKey][name] = grade;
          }
        }
      }
    }

    return out;
  };

  const countRows = (obj: Record<string, Record<string, string>>) =>
    Object.values(obj).reduce((a, b) => a + Object.keys(b).length, 0);

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
    a.download = "대구소프트웨어마이스터고_교과성적_입력템플릿.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <style>{`
        /* Pretendard Variable (CDN) */
        @import url('https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css');

        *, *::before, *::after{ box-sizing: border-box; }
        :root{
          --gray-50:#f8fafc; --gray-80:#f5f7fa; --gray-100:#f1f5f9; --gray-200:#e2e8f0; --gray-300:#cbd5e1;
          --gray-400:#94a3b8; --gray-500:#64748b; --gray-600:#475569; --gray-700:#334155; --gray-900:#0f172a;
          --white:#ffffff; --danger-500:#ef4444;
          --radius-sm:8px; --radius-md:10px; --radius-lg:12px; --ring-focus:2px;

          --col-grade-width: 220px;
          --col-action-width: 72px;
        }

        .page{
          width:960px; min-width:960px; max-width:960px; margin:0 auto;
          color: var(--gray-900); background: var(--white);
          min-height:100vh; padding:28px;
          font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial;
          font-size:14px;
        }

        /* === 타이포 스케일: 16 / 14 / 12 === */
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
          background-size: 5px 5px, 5px 5px, 2.5em 2.5em; background-repeat:no-repeat;
          padding-right: 36px;
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
        .year-block{ margin-top:12px }
        .year-title{ font-size:14px; color: var(--gray-600); font-weight:700; margin: 6px 2px }
        .year-grid{ display:grid; grid-template-columns: 1fr 1fr; gap:12px }
        .att-grid{ display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
        .att-meta{ font-size:12px; color:var(--gray-500); }
        .uploader{ display:flex; align-items:center; gap:12px; margin:20px 0; padding:16px; background:var(--gray-50); border-radius:8px; }
        .uploader small{ color:var(--gray-500); font-size:12px; }
      `}</style>

      <button className="btn" onClick={onBack || (() => window.history.back())} style={{ marginBottom: "20px" }}>
        ← 목록으로
      </button>

      <h1>대구소프트웨어마이스터고 1차 전형 모의 성적 계산기</h1>
      <div className="muted" style={{ margin: "10px 0" }}>
        • 1차 전형만 계산합니다. (2차 전형의 면접/소양평가 등은 제외) <br />•
        출결/봉사/가산점 기준일: <b>2025-09-30</b> (졸업생은 졸업일 기준) —{" "}
        <b>생활기록부 등재</b>만 인정합니다. <br />• 반영 교과:
        국/수/영/사/도/과/역/정 — 수/과/정보는 <b>2배 가중</b>, P/F 과목은
        제외합니다.
      </div>

      {/* 자유학기 유효성 경고/안내 */}
      {!validateFreeOneYearOnly() && (
        <div className="err">
          ⚠ 자유학기는 <b>한 학년 내에서만</b> 선택할 수 있습니다. 학년을 넘는
          동시 선택은 허용되지 않습니다.
        </div>
      )}
      {studentOnly3_1Free && (
        <div className="muted" style={{ marginTop: 6 }}>
          ℹ 재학생이 <b>3-1 자유학기</b>를 선택하면 3-2는 원천 미반영이므로{" "}
          <b>3학년 전체 없음</b>으로 계산(보정)됩니다.
        </div>
      )}

      {/* 지원 유형 */}
      <section className="card" style={{ marginTop: 12, marginBottom: 16 }}>
        <h3>지원 유형</h3>
        <div className="stack">
          {(["재학생", "졸업생", "검정고시"] as ApplicantType[]).map((t) => (
            <label key={t} className="pill">
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

      {/* 교과 성적 입력 */}
      {atype !== "검정고시" && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3>교과 성적 입력</h3>
          <div className="muted">
            과목은 고정(8개)이며 수학/과학/정보는 <b>2배 가중</b>됩니다. P/F
            과목은 입력하지 않습니다.
          </div>

          {/* 학년별 2열 */}
          {[1, 2, 3].map((year) => (
            <div key={year} className="year-block">
              <div className="year-title">{year}학년</div>
              <div className="year-grid">
                {SEMS.filter((s) => s.year === year).map((sem) => {
                  const disabled = isSemDisabled(sem.key);
                  const effW = effectiveWeights[sem.key] || 0;

                  return (
                    <div
                      key={sem.key}
                      className={`sem-box ${disabled ? "dim" : ""}`}
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
                            <strong>학기: {sem.key}</strong>
                            <span className="muted">
                              실효 가중치 ×{round3(effW)}
                            </span>
                          </div>
                        </div>
                        <label
                          className="pill"
                          style={{ opacity: disabled ? 0.5 : 1 }}
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
                            disabled={atype === "재학생" && sem.key === "3-2"}
                          />
                          자유학기
                        </label>
                      </div>

                      <div style={{ padding: 10 }}>
                        {/* 헤더 */}
                        <div
                          className="row-grid muted"
                          style={{ marginBottom: 4 }}
                        >
                          <div>과목</div>
                          <div>등급</div>
                          <div style={{ textAlign: "right" }}>가중</div>
                        </div>

                        {/* 과목 행 */}
                        {SUBJECTS.map((s) => (
                          <div
                            key={`${sem.key}-${s.key}`}
                            className="row-grid"
                            style={{ marginBottom: 8 }}
                          >
                            <div className="muted" style={{ fontSize: 14 }}>
                              {s.key}
                            </div>
                            <select
                              className="ui-select"
                              value={grades[sem.key]?.[s.key] ?? ""}
                              onChange={(e) =>
                                setGrade(sem.key, s.key, e.target.value)
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
                            <div
                              className="muted"
                              style={{ textAlign: "right" }}
                            >
                              ×{s.w}
                            </div>
                          </div>
                        ))}

                        <div className="muted" style={{ marginTop: 6 }}>
                          평균(1~5) = (가중합 ÷ 가중수). P/F 및 미선택은
                          제외됩니다.
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
          <div className="muted">
            환산: 98~100→5, 94~98→4, 90~94→3, 86~90→2, 86 미만→1 →
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
                  style={{ width: 140 }}
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
            산식: 10 − (결석×2), 지각/조퇴/결과는 <b>3회=결석 1일</b>로
            환산(2회 이하는 버림)
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
          <h3>봉사활동 · 가산점</h3>

          <div className="stack">

            {/* 봉사 */}
            <div className="card" style={{ flex: 1, minWidth: 280 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>봉사 (6점)</div>
              <div className="stack" style={{ gap: 8 }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>
                    1학년 봉사시간
                  </div>
                  <input
                    className="ui-input"
                    type="number"
                    min={0}
                    step={0.5}
                    value={vol1}
                    onChange={(e) => setVol1(Number(e.target.value))}
                  />
                  <div className="muted" style={{ marginTop: 4, marginBottom: 6 }}>
                    실행년도
                  </div>
                  <input
                    className="ui-input"
                    type="number"
                    min={2020}
                    max={2025}
                    value={vol1Year}
                    onChange={(e) => setVol1Year(e.target.value)}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>
                    2학년 봉사시간
                  </div>
                  <input
                    className="ui-input"
                    type="number"
                    min={0}
                    step={0.5}
                    value={vol2}
                    onChange={(e) => setVol2(Number(e.target.value))}
                  />
                  <div className="muted" style={{ marginTop: 4, marginBottom: 6 }}>
                    실행년도
                  </div>
                  <input
                    className="ui-input"
                    type="number"
                    min={2020}
                    max={2025}
                    value={vol2Year}
                    onChange={(e) => setVol2Year(e.target.value)}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>
                    3학년 봉사시간
                  </div>
                  <input
                    className="ui-input"
                    type="number"
                    min={0}
                    step={0.5}
                    value={vol3}
                    onChange={(e) => setVol3(Number(e.target.value))}
                  />
                  <div className="muted" style={{ marginTop: 4, marginBottom: 6 }}>
                    실행년도
                  </div>
                  <input
                    className="ui-input"
                    type="number"
                    min={2020}
                    max={2025}
                    value={vol3Year}
                    onChange={(e) => setVol3Year(e.target.value)}
                  />
                </div>
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                2024년 이후: 10h↑=2.0 / 7~&lt;10=1.6 / &lt;7=1.2<br/>
                2024년 이전: 10h↑=1.0 / 7~&lt;10=0.8 / &lt;7=0.6<br/>
                (0시간 포함) · 합계 최대 6.0
              </div>
            </div>
          </div>

          {/* 가산점 */}
          <div className="stack" style={{ marginTop: 16 }}>
            <div className="card" style={{ flex: 1, minWidth: 280 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                리더십 가산점 (최대 2점)
              </div>
              <div className="stack" style={{ gap: 8 }}>
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
                전교 회장·부회장·학급반장(부반장 제외), <b>학기 전체</b> 수행만
                인정. 재학생은 3-1까지만 인정.
              </div>
            </div>

            <div className="card" style={{ flex: 1, minWidth: 280 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                모범상 가산점 (최대 2점)
              </div>
              <div className="muted" style={{ marginBottom: 6 }}>
                모범상 수상 횟수 (1회=1점, 최대 2점)
              </div>
              <input
                className="ui-input"
                type="number"
                min={0}
                step={1}
                value={awardsCount}
                onChange={(e) => setAwardsCount(Number(e.target.value))}
              />
              <div className="muted" style={{ marginTop: 6 }}>
                예: 모범/선행/효행/공로/노력상 등 <b>교내</b> 수상만 인정.
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
            <div className="stack">
              <div className="card" style={{ flex: 1, minWidth: 150 }}>
                <div className="muted">교과 성적 (80)</div>
                <div className="kpi">{courseScore.toFixed(3)}</div>
              </div>
              <div className="card" style={{ flex: 1, minWidth: 150 }}>
                <div className="muted">출결 (10)</div>
                <div className="kpi">{attScore.toFixed(3)}</div>
              </div>
              <div className="card" style={{ flex: 1, minWidth: 150 }}>
                <div className="muted">봉사 (6)</div>
                <div className="kpi">{volScore.toFixed(3)}</div>
              </div>
              <div className="card" style={{ flex: 1, minWidth: 150 }}>
                <div className="muted">리더십 (2)</div>
                <div className="kpi">{leaderScore.toFixed(3)}</div>
              </div>
              <div className="card" style={{ flex: 1, minWidth: 150 }}>
                <div className="muted">모범상 (2)</div>
                <div className="kpi">{awardScore.toFixed(3)}</div>
              </div>
            </div>

            <div className="subcard" style={{ marginTop: 12 }}>
              <div className="muted" style={{ marginBottom: 6 }}>
                총점 (100점 만점)
              </div>
              <div className="kpi" style={{ fontSize: 20 }}>
                {totalScore.toFixed(3)}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="muted">교과 성적 (100)</div>
              <div className="kpi" style={{ fontSize: 20 }}>
                {courseScore.toFixed(3)}
              </div>
            </div>
            <div className="subcard">
              <div className="muted" style={{ marginBottom: 6 }}>
                총점 (100점 만점)
              </div>
              <div className="kpi" style={{ fontSize: 20 }}>
                {totalScore.toFixed(3)}
              </div>
            </div>
          </>
        )}
      </section>

    </div>
  );
}
