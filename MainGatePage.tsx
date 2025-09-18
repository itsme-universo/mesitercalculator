import React from "react";

interface MainGatePageProps {
  onSelectRole: (role: "student" | "teacher") => void;
}

export default function MainGatePage({ onSelectRole }: MainGatePageProps) {
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

        .role-grid{ display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-top:20px }
        .role-card{ 
          border:2px solid var(--gray-200); border-radius:var(--radius-lg); padding:24px; 
          text-align:center; cursor:pointer; transition: all 0.2s ease;
          background: var(--white);
        }
        .role-card:hover{ 
          border-color: var(--gray-400); 
          background: var(--gray-50);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .role-icon{ font-size:48px; margin-bottom:16px }
        .role-title{ font-size:18px; font-weight:700; margin-bottom:8px; color: var(--gray-900) }
        .role-desc{ font-size:14px; color: var(--gray-600); line-height:1.5 }
      `}</style>

      <h1>성적 계산기</h1>
      <div className="muted" style={{ margin: "10px 0" }}>
        학생용과 선생님용 계산기를 선택하세요.
      </div>

      <div className="role-grid">
        <div className="role-card" onClick={() => onSelectRole("student")}>
          <div className="role-icon">🎓</div>
          <div className="role-title">학생용</div>
          <div className="role-desc">
            개별 성적을 입력하여<br />
            모의 성적을 계산합니다
          </div>
        </div>

        <div className="role-card" onClick={() => onSelectRole("teacher")}>
          <div className="role-icon">👨‍🏫</div>
          <div className="role-title">선생님용</div>
          <div className="role-desc">
            대량 엑셀 데이터를<br />
            일괄 처리하여 계산합니다
          </div>
        </div>
      </div>
    </div>
  );
}
