import React from "react";

interface TeacherGatePageProps {
  onSelectSchool: (schoolId: string) => void;
}

interface SchoolInfo {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
}

const schools: SchoolInfo[] = [
  {
    id: "agriculture",
    name: "대구농업마이스터고",
    description: "교과 성적만 반영",
    color: "#22c55e",
    icon: "🌾"
  },
  {
    id: "semiconductor", 
    name: "대구반도체마이스터고",
    description: "교과+출결+봉사+리더십+경력+수상",
    color: "#3b82f6",
    icon: "🔬"
  },
  {
    id: "software",
    name: "대구소프트웨어마이스터고", 
    description: "교과+출결+봉사+리더십+수상",
    color: "#8b5cf6",
    icon: "💻"
  },
  {
    id: "il",
    name: "대구일마이스터고", 
    description: "교과+출결",
    color: "#f59e0b",
    icon: "🏭"
  }
];

export default function TeacherGatePage({ onSelectSchool }: TeacherGatePageProps) {
  return (
    <div className="page">
      <style>{`
        /* Pretendard Variable (CDN) */
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
          color: var(--gray-900); background: var(--white);
          min-height:100vh; padding:28px;
          font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial;
          font-size:14px;
        }

        h1{ font-size:24px; font-weight:800; margin:0 0 20px; text-align:center; }
        h2{ font-size:18px; font-weight:700; margin:0 0 16px; }
        .muted{ font-size:12px; color: var(--gray-500); line-height:1.6; text-align:center; margin-bottom:32px; }

        .schools-grid{
          display:grid; grid-template-columns: repeat(2, 1fr); gap:20px; margin-top:20px;
        }

        .school-card{
          background:var(--white); border:2px solid var(--gray-200); border-radius:var(--radius-lg);
          padding:24px; cursor:pointer; transition: all 0.2s ease; position:relative; overflow:hidden;
        }

        .school-card:hover{
          border-color: var(--gray-300); transform: translateY(-2px);
          box-shadow: 0 8px 25px rgba(0,0,0,0.1);
        }

        .school-card::before{
          content:''; position:absolute; top:0; left:0; right:0; height:4px;
          background: var(--school-color); transition: height 0.2s ease;
        }

        .school-card:hover::before{ height:6px; }

        .school-icon{
          font-size:32px; margin-bottom:12px; display:block;
        }

        .school-name{
          font-size:16px; font-weight:700; margin-bottom:8px; color:var(--gray-900);
        }

        .school-description{
          font-size:12px; color:var(--gray-500); margin-bottom:16px;
        }

        .school-features{
          list-style:none; padding:0; margin:0;
        }

        .school-features li{
          font-size:11px; color:var(--gray-600); margin-bottom:4px;
          padding-left:12px; position:relative;
        }

        .school-features li::before{
          content:'•'; color:var(--school-color); font-weight:bold;
          position:absolute; left:0;
        }

        .back-btn{
          position:absolute; top:20px; left:20px; background:var(--gray-100);
          border:1px solid var(--gray-300); border-radius:var(--radius-sm);
          padding:8px 12px; cursor:pointer; font-size:12px; color:var(--gray-600);
          transition: all 0.2s ease;
        }

        .back-btn:hover{
          background:var(--gray-200); color:var(--gray-900);
        }
      `}</style>

      <button className="back-btn" onClick={() => window.location.href = "/"}>
        ← 역할 선택으로
      </button>

      <h1>선생님용 계산기</h1>
      <div className="muted">
        각 학교별 대량 엑셀 처리 계산기를 선택하세요
      </div>

      <div className="schools-grid">
        {schools.map((school) => (
          <div
            key={school.id}
            className="school-card"
            onClick={() => onSelectSchool(school.id)}
            style={{ '--school-color': school.color } as React.CSSProperties}
          >
            <span className="school-icon">{school.icon}</span>
            <div className="school-name">{school.name}</div>
            <div className="school-description">{school.description}</div>
            <ul className="school-features">
              <li>대량 엑셀 업로드</li>
              <li>자동 성적 계산</li>
              <li>결과 엑셀 다운로드</li>
              <li>진행상황 표시</li>
              <li>오류 처리</li>
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}