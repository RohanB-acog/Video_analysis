import React from "react";
import { Routes, Route } from "react-router-dom";
import Dashboard from "./Dashboard";
import ContentItemsPage from "./ContentItemsPage";

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/content-items" element={<ContentItemsPage />} />
    </Routes>
  );
};

export default App;