// App.tsx
import React, { useState } from "react";
import MainGatePage from "./MainGatePage";
import TeacherGatePage from "./TeacherGatePage";
import GatePage from "./GatePage";
import SemiconductorCalculator from "./SemiconductorCalculator";
import SoftwareCalculator from "./SoftwareCalculator";
import IlCalculator from "./IlCalculator";
import AgricultureCalculator from "./AgricultureCalculator";
import TeacherAgricultureCalculator from "./TeacherAgricultureCalculator";
import TeacherSemiconductorCalculator from "./TeacherSemiconductorCalculator";
import TeacherSoftwareCalculator from "./TeacherSoftwareCalculator";
import TeacherIlCalculator from "./TeacherIlCalculator";

// 간단한 라우팅 로직
export default function App() {
  const path = window.location.pathname;
  
  // 메인 게이트 페이지
  if (path === "/" || path === "") {
    return <MainGatePage onSelectRole={(role) => {
      if (role === "student") {
        window.location.href = "/student";
      } else {
        window.location.href = "/teacher";
      }
    }} />;
  }
  
  // 선생님용 게이트 페이지
  if (path === "/teacher" || path === "/teacher/") {
    return <TeacherGatePage onSelectSchool={(schoolId) => {
      window.location.href = `/teacher/${schoolId}`;
    }} />;
  }
  
  // 선생님용 계산기들
  if (path === "/teacher/agriculture") {
    return <TeacherAgricultureCalculator />;
  } else if (path === "/teacher/semiconductor") {
    return <TeacherSemiconductorCalculator />;
  } else if (path === "/teacher/software") {
    return <TeacherSoftwareCalculator />;
  } else if (path === "/teacher/il") {
    return <TeacherIlCalculator />;
  }
  
  // 학생용 게이트 페이지
  if (path === "/student" || path === "/student/") {
    return <GatePage />;
  } else if (path === "/student/agriculture") {
    return <AgricultureCalculator />;
  } else if (path === "/student/semiconductor") {
    return <SemiconductorCalculator />;
  } else if (path === "/student/software") {
    return <SoftwareCalculator />;
  } else if (path === "/student/il") {
    return <IlCalculator />;
  }
  
  // 기본값은 메인 게이트 페이지
  return <MainGatePage onSelectRole={(role) => {
    if (role === "student") {
      window.location.href = "/student";
    } else {
      window.location.href = "/teacher";
    }
  }} />;
}
