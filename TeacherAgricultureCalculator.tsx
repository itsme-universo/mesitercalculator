import React, { useRef, useState } from "react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";

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

// 등급→점수
function mapGradeToPoint(v?: string | null) {
  const t = (v || "").trim().toUpperCase();
  const map: Record<string, number> = {
    "A/수": 5, "B/우": 4, "C/미": 3, "D/양": 2, "E/가": 1,
    "A/우수": 5, "B/보통": 4, "C/미흡": 3,
    A: 5, B: 4, C: 3, D: 2, E: 1,
    "수": 5, "우": 4, "미": 3, "양": 2, "가": 1,
    "우수": 5, "보통": 4, "미흡": 3,
  };
  if (!t) return null;
  
  // 정확한 매칭 시도
  if (map[t]) return map[t];
  
  // 부분 매칭 시도 (A, B, C, D, E만 있는 경우)
  if (t.length === 1 && ['A', 'B', 'C', 'D', 'E'].includes(t)) {
    return map[t];
  }
  
  // 수, 우, 미, 양, 가만 있는 경우
  if (['수', '우', '미', '양', '가'].includes(t)) {
    return map[t];
  }
  
  console.log(`등급 인식 실패: "${v}" -> "${t}"`);
  return null;
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

// 학기 형식 변환: "1학년 1학기" -> "1-1"
function convertSemesterFormat(semesterStr: string) {
  const match = semesterStr.match(/(\d)학년\s*(\d)학기/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return semesterStr; // 변환 실패 시 원본 반환
}

type SubjRow = { name: string; grade: string };

interface StudentData {
  name: string;
  track: TrackType;
  atype: ApplicantType;
  subjects: Record<string, SubjRow[]>;
  freeSem: Record<string, boolean>;
  gedSubjects: { subject: string; score: number }[];
}

export default function TeacherAgricultureCalculator() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [resultData, setResultData] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 자유학기 유효성 검사
  const isFreeSemValid = (freeSem: Record<string, boolean>, atype: ApplicantType) => {
    if (atype === "검정고시") return true;
    const selected = Object.keys(freeSem).filter((k) => freeSem[k] && baseCoeff(atype, k) > 0);
    if (selected.length === 0) return true;
    const years = new Set<number>();
    for (const k of selected) {
      const m = SEMS.find((s) => s.key === k);
      if (m) years.add(m.year);
    }
    return years.size <= 1;
  };

  // 실효 계수 계산
  const calculateEffectiveCoeffs = (atype: ApplicantType, freeSem: Record<string, boolean>) => {
    const eff: Record<string, number> = {};
    for (const s of SEMS) eff[s.key] = baseCoeff(atype, s.key);

    if (atype !== "검정고시") {
      // 규칙2: 학년 내 한 학기만 자유 → 다른 학기에 연간 합계 몰아주기
      for (const year of [1, 2, 3]) {
        const yearSems = SEMS.filter((s) => s.year === year);
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

      // 규칙3: 학년 전체 자유 → 차상학년 이관
      const addToYear = (targetYear: number, add: number) => {
        if (add <= 0) return;
        const tSems = SEMS.filter((s) => s.year === targetYear);
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
        SEMS.filter((s) => s.year === y).reduce((a, s) => a + eff[s.key], 0);
      const yearBaseTotal = (y: number) =>
        SEMS.filter((s) => s.year === y).reduce((a, s) => a + baseCoeff(atype, s.key), 0);

      if (yearEffTotal(1) === 0 && yearBaseTotal(1) > 0) addToYear(2, yearBaseTotal(1));
      if (yearEffTotal(2) === 0 && yearBaseTotal(2) > 0) addToYear(1, yearBaseTotal(2));
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
  };

  // 학기 평균 계산
  const calculateSemStats = (subjects: Record<string, SubjRow[]>, semKey: string) => {
    const rows = subjects[semKey] || [];
    let cnt = 0, num = 0, den = 0;
    for (const r of rows) {
      const p = mapGradeToPoint(r.grade);
      if (p == null) continue;
      num += p; den += 1; cnt += 1;
    }
    const avg = den === 0 ? 0 : num / den;
    return { count: cnt, avg };
  };

  // 점수 계산
  const calculateScore = (student: StudentData) => {
    const { track, atype, subjects, freeSem, gedSubjects } = student;
    const effectiveCoeffs = calculateEffectiveCoeffs(atype, freeSem);

    console.log(`=== ${student.name} 계산 시작 ===`);
    console.log('지원유형:', atype);
    console.log('과목 데이터:', subjects);
    console.log('자유학기:', freeSem);
    console.log('유효 계수:', effectiveCoeffs);

    if (atype === "검정고시") {
      if (gedSubjects.length === 0) return { courseScore: 0, totalScore: 0, courseMax: track === "일반전형" ? 40 : 30 };
      const pts = gedSubjects.filter((v) => Number.isFinite(v.score)).map((v) => scoreToPointGED(v.score));
      if (pts.length === 0) return { courseScore: 0, totalScore: 0, courseMax: track === "일반전형" ? 40 : 30 };
      const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
      const factor = track === "일반전형" ? 8 : 6;
      const courseScore = round3(avg * factor);
      const courseMax = track === "일반전형" ? 40 : 30;
      return { courseScore, totalScore: courseScore, courseMax };
    } else {
      let sum = 0;
      for (const s of SEMS) {
        const w = effectiveCoeffs[s.key];
        if (w <= 0) continue;
        const { avg, count } = calculateSemStats(subjects, s.key);
        console.log(`${s.key} 학기: ${count}개 과목, 평균 ${avg}점 (가중치: ${w})`);
        sum += avg * w;
      }
      const factor = track === "일반전형" ? 0.4 : 0.3;
      const courseScore = round3(sum * factor);
      const courseMax = track === "일반전형" ? 40 : 30;
      console.log(`최종 교과성적: ${courseScore}점 (총합: ${sum}, 계수: ${factor})`);
      return { courseScore, totalScore: courseScore, courseMax };
    }
  };

  // 엑셀 업로드 처리
  const handleFileUpload = async (file: File) => {
    console.log('엑셀 업로드 시작:', file.name);
    setIsProcessing(true);
    setUploadMessage("파일을 처리 중입니다...");

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      const students: StudentData[] = [];
      const headers = (jsonData[0] as any[]) || [];
      
      // 헤더에서 컬럼 인덱스 찾기
      console.log('엑셀 헤더:', headers);
      
      const nameIdx = headers.findIndex((h: any) => 
        String(h).includes("이름") || String(h).includes("성명") || String(h).includes("name")
      );
      const trackIdx = headers.findIndex((h: any) => 
        String(h).includes("전형") || String(h).includes("track")
      );
      const atypeIdx = headers.findIndex((h: any) => 
        String(h).includes("유형") || String(h).includes("지원") || String(h).includes("type")
      );
      const subjectIdx = headers.findIndex((h: any) => 
        String(h).includes("학기/과목") || String(h).includes("과목")
      );
      const gradeIdx = headers.findIndex((h: any) => 
        String(h).includes("성적") || String(h).includes("등급") || String(h).includes("grade")
      );
      
      console.log('컬럼 인덱스:', { nameIdx, trackIdx, atypeIdx, subjectIdx, gradeIdx });


      if (nameIdx === -1) {
        throw new Error("이름 컬럼을 찾을 수 없습니다.");
      }

      // 학생별로 데이터 그룹화
      const studentGroups: { [key: string]: any[][] } = {};
      let currentStudent = "";

      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i] as any[];
        if (!row || row.length === 0) continue;

        const name = String(row[nameIdx] || "").trim();
        if (name) {
          currentStudent = name;
          if (!studentGroups[currentStudent]) {
            studentGroups[currentStudent] = [];
          }
        }
        
        if (currentStudent) {
          studentGroups[currentStudent].push(row);
        }
      }

      // 각 학생 데이터 처리
      for (const [studentName, rows] of Object.entries(studentGroups)) {
        if (!studentName || rows.length === 0) continue;

        const firstRow = rows[0];
        const track = (firstRow[trackIdx] || "일반전형").toString().includes("특별") ? "특별전형" : "일반전형";
        const atypeRaw = (firstRow[atypeIdx] || "졸업예정자").toString();
        let atype: ApplicantType = "졸업예정자";
        if (atypeRaw.includes("졸업생")) atype = "졸업생";
        else if (atypeRaw.includes("검정고시")) atype = "검정고시";

        // 과목 데이터 추출
        const subjects: Record<string, SubjRow[]> = {};
        const freeSem: Record<string, boolean> = {};
        
        for (const s of SEMS) {
          subjects[s.key] = [];
          freeSem[s.key] = false;
        }

        // 자유학기 정보 추출 (엑셀에서 자유학기 컬럼이 있다면)
        const freeSemIdx = headers.findIndex((h: any) => 
          String(h).includes("자유학기") || String(h).includes("자유")
        );
        
        console.log('자유학기 컬럼 인덱스:', freeSemIdx);
        
        if (freeSemIdx !== -1) {
          const freeSemData = String(firstRow[freeSemIdx] || "").trim();
          console.log('자유학기 데이터:', freeSemData);
          if (freeSemData) {
            // "1-1,2-1" 형식으로 파싱
            const freeSemKeys = freeSemData.split(",").map(s => s.trim());
            for (const key of freeSemKeys) {
              if (SEMS.some(s => s.key === key)) {
                freeSem[key] = true;
                console.log(`자유학기 설정: ${key}`);
              }
            }
          }
        }

        const gedSubjects: { subject: string; score: number }[] = [];

        // 각 행에서 과목 데이터 추출
        for (const row of rows) {
          const subjectInfo = String(row[subjectIdx] || "").trim();
          const grade = String(row[gradeIdx] || "").trim();
          
          if (!subjectInfo || !grade) continue;

          if (atype === "검정고시") {
            // 검정고시: 과목명과 점수
            const score = Number(grade);
            if (Number.isFinite(score)) {
              gedSubjects.push({ subject: subjectInfo, score: Math.max(0, Math.min(100, score)) });
            }
          } else {
            // 일반/졸업: 학기|과목명 형식 파싱
            if (subjectInfo.includes("|")) {
              const [semInfo, subjectName] = subjectInfo.split("|");
              const semKey = convertSemesterFormat(semInfo.trim());
              
              console.log(`파싱: "${subjectInfo}" -> 학기: "${semInfo.trim()}" -> "${semKey}", 과목: "${subjectName.trim()}", 등급: "${grade}"`);
              
              if (SEMS.some(s => s.key === semKey)) {
                subjects[semKey].push({ name: subjectName.trim(), grade: grade });
                console.log(`과목 추가됨: ${semKey}에 ${subjectName.trim()} (${grade})`);
              } else {
                console.log(`과목 추가 실패: ${semKey} (유효하지 않은 학기)`);
              }
            } else {
              console.log(`과목 형식 오류: "${subjectInfo}" (| 구분자 없음)`);
            }
          }
        }

        const student: StudentData = {
          name: studentName,
          track,
          atype,
          subjects,
          freeSem,
          gedSubjects
        };

        students.push(student);
      }

      // 각 학생의 점수 계산
      const results = students.map(student => {
        const score = calculateScore(student);
        return {
          ...student,
          ...score,
          isValid: isFreeSemValid(student.freeSem, student.atype)
        };
      });

      setResultData(results);
      setUploadMessage(`성공적으로 처리되었습니다. (${results.length}명)`);
      
    } catch (error) {
      console.error("Upload error:", error);
      setUploadMessage(`오류가 발생했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 결과 엑셀 다운로드
  const downloadResults = async () => {
    if (resultData.length === 0) return;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("계산 결과");

    // 헤더 설정
    const headers = [
      "이름", "전형", "지원유형", "교과성적", "총점", "유효성"
    ];
    worksheet.addRow(headers);

    // 데이터 추가
    resultData.forEach(student => {
      worksheet.addRow([
        student.name,
        student.track,
        student.atype,
        student.courseScore.toFixed(3),
        student.totalScore.toFixed(3),
        student.isValid ? "유효" : "무효"
      ]);
    });

    // 스타일 적용
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" }
    };

    // 컬럼 너비 설정
    worksheet.getColumn(1).width = 15;
    worksheet.getColumn(2).width = 12;
    worksheet.getColumn(3).width = 12;
    worksheet.getColumn(4).width = 15;
    worksheet.getColumn(5).width = 15;
    worksheet.getColumn(6).width = 10;

    // 파일 다운로드
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "농업마이스터고_계산결과.xlsx";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // 샘플 엑셀 다운로드
  const downloadSample = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("샘플 데이터");

    // 헤더 설정
    const headers = [
      "수험번호", "이름", "전형", "지원유형", 
      "중학교-학기/과목", "중학교-성적", "자유학기"
    ];
    worksheet.addRow(headers);

    // 샘플 데이터 (농업마이스터고는 교과 성적만)
    const sampleData = [
      ["00000-00001", "홍길동", "일반전형", "졸업예정자", "1학년1학기|국어", "A", "1-1"],
      ["", "", "", "", "1학년1학기|영어", "B", ""],
      ["", "", "", "", "1학년1학기|수학", "A", ""],
      ["", "", "", "", "1학년1학기|과학", "A", ""],
      ["", "", "", "", "1학년2학기|국어", "A", ""],
      ["", "", "", "", "1학년2학기|영어", "B", ""],
      ["", "", "", "", "1학년2학기|수학", "A", ""],
      ["", "", "", "", "1학년2학기|과학", "A", ""],
      ["", "", "", "", "2학년1학기|국어", "A", ""],
      ["", "", "", "", "2학년1학기|영어", "A", ""],
      ["", "", "", "", "2학년1학기|수학", "A", ""],
      ["", "", "", "", "2학년1학기|과학", "A", ""],
      ["", "", "", "", "2학년2학기|국어", "A", ""],
      ["", "", "", "", "2학년2학기|영어", "A", ""],
      ["", "", "", "", "2학년2학기|수학", "A", ""],
      ["", "", "", "", "2학년2학기|과학", "A", ""],
      ["", "", "", "", "3학년1학기|국어", "A", ""],
      ["", "", "", "", "3학년1학기|영어", "A", ""],
      ["", "", "", "", "3학년1학기|수학", "A", ""],
      ["", "", "", "", "3학년1학기|과학", "A", ""],
      ["00000-00002", "김철수", "특별전형", "졸업생", "1학년1학기|국어", "B", ""],
      ["", "", "", "", "1학년1학기|영어", "B", ""],
      ["", "", "", "", "1학년1학기|수학", "A", ""],
      ["", "", "", "", "1학년1학기|과학", "A", ""],
      ["00000-00003", "이영희", "일반전형", "검정고시", "과목1", "95", ""],
      ["", "", "", "", "과목2", "88", ""],
      ["", "", "", "", "과목3", "92", ""]
    ];
    
    sampleData.forEach(row => {
      worksheet.addRow(row);
    });

    // 스타일 적용
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" }
    };

    // 컬럼 너비 설정
    worksheet.getColumn(1).width = 15;
    worksheet.getColumn(2).width = 12;
    worksheet.getColumn(3).width = 12;
    worksheet.getColumn(4).width = 12;
    worksheet.getColumn(5).width = 20;
    worksheet.getColumn(6).width = 12;

    // 파일 다운로드
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "농업마이스터고_샘플데이터.xlsx";
    a.click();
    window.URL.revokeObjectURL(url);
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
          border-radius:var(--radius-sm); padding:8px 12px; transition: all .15s ease; outline:none; appearance:none;
          font-size:14px;
        }
        .ui-input::placeholder{ color:var(--gray-400) }
        .ui-input:hover, .ui-select:hover{ background:var(--gray-80) }
        .ui-input:focus, .ui-select:focus{ border-color: var(--gray-900); outline: var(--ring-focus) solid var(--gray-900) }
        .ui-input:disabled, .ui-select:disabled{ background:var(--gray-100); color:var(--gray-400); border-color: var(--gray-200); cursor:not-allowed }

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

        .uploader{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:10px; border:1px dashed var(--gray-300); background:var(--gray-50); border-radius:10px; margin-top:10px; font-size:14px }
        .uploader small{ color:var(--gray-500); font-size:12px }

        .spinner{ 
          display: inline-block; width: 20px; height: 20px; border: 2px solid var(--gray-300); 
          border-radius: 50%; border-top-color: var(--gray-900); animation: spin 1s ease-in-out infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .result-table{ width:100%; border-collapse:collapse; margin-top:16px; font-size:12px }
        .result-table th, .result-table td{ border:1px solid var(--gray-200); padding:8px; text-align:left }
        .result-table th{ background:var(--gray-50); font-weight:700 }
        .result-table tr:nth-child(even){ background:var(--gray-50) }
      `}</style>

      <button className="btn" onClick={() => window.location.href = "/teacher"} style={{ marginBottom: "20px" }}>
        ← 목록으로
      </button>

      <h1>대구농업마이스터고 선생님용 계산기</h1>
      <div className="muted" style={{ margin: "10px 0" }}>
        대량 엑셀 데이터를 업로드하여 일괄 계산하세요.
      </div>

      {/* 업로드 섹션 */}
      <section className="card" style={{ marginBottom: 16 }}>
        <h3>엑셀 업로드</h3>
        <div className="uploader">
          <button className="btn" onClick={downloadSample}>샘플 엑셀 다운로드</button>

          <input
            ref={fileInputRef}
            onChange={(e) => {
              console.log('파일 선택됨:', e.target.files);
              const file = e.target.files?.[0];
              if (file) {
                console.log('파일 업로드 시작:', file.name);
                handleFileUpload(file);
              } else {
                console.log('파일이 선택되지 않음');
              }
            }}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: "none" }}
          />
          <button 
            className="btn" 
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <span className="spinner" style={{ marginRight: 8 }}></span>
                처리 중...
              </>
            ) : (
              "엑셀 업로드"
            )}
          </button>

          <small>
            엑셀 파일에 이름, 전형, 지원유형 컬럼이 포함되어야 합니다.
          </small>
          {uploadMessage && <div className="muted">{uploadMessage}</div>}
        </div>
      </section>

      {/* 결과 섹션 */}
      {resultData.length > 0 && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3>계산 결과 ({resultData.length}명)</h3>
            <button className="btn" onClick={downloadResults}>결과 다운로드</button>
          </div>
          
          <div style={{ maxHeight: "400px", overflow: "auto" }}>
            <table className="result-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>전형</th>
                  <th>지원유형</th>
                  <th>교과성적</th>
                  <th>총점</th>
                  <th>유효성</th>
                </tr>
              </thead>
              <tbody>
                {resultData.map((student, index) => (
                  <tr key={index}>
                    <td>{student.name}</td>
                    <td>{student.track}</td>
                    <td>{student.atype}</td>
                    <td>{student.courseScore.toFixed(3)}</td>
                    <td>{student.totalScore.toFixed(3)}</td>
                    <td style={{ color: student.isValid ? "green" : "red" }}>
                      {student.isValid ? "유효" : "무효"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
