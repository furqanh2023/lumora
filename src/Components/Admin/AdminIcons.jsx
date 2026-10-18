import React from "react";

const drawings = {
  Activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
  AlertTriangle: <><path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></>,
  ArrowDownToLine: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
  BarChart3: <><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></>,
  Check: <><path d="m5 12 4 4L19 6"/></>,
  CheckCircle2: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
  CircleHelp: <><circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.7"/><path d="M12 17h.01"/></>,
  FileText: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
  MessageSquare: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8Z"/></>,
  Pencil: <><path d="m15 5 4 4M4 20l4-.9L19.2 8a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z"/></>,
  Plus: <><path d="M12 5v14M5 12h14"/></>,
  RefreshCw: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 17 6l3 6M4 12l3 6a7 7 0 0 0 11.4-3"/></>,
  Search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
  ShieldAlert: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="M12 8v4M12 16h.01"/></>,
  ShieldCheck: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
  Trash2: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6"/></>,
  Users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></>,
  X: <><path d="m18 6-12 12M6 6l12 12"/></>,
  Eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  EyeOff: <><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a15.5 15.5 0 0 1-3.2 4.1M6.2 6.2C3.5 8.1 2 12 2 12s3.5 7 10 7a10 10 0 0 0 4.1-.9"/></>,
  ChevronRight: <><path d="m9 18 6-6-6-6"/></>,
  LayoutDashboard: <><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/></>,
  Menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  LogOut: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
  Moon: <><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/></>,
  Sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
};

export default function AdminIcon({ name, size = 18, strokeWidth = 1.8, className, ...props }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{drawings[name] || <circle cx="12" cy="12" r="8" />}</svg>;
}

export const Activity = (props) => <AdminIcon name="Activity" {...props} />;
export const AlertTriangle = (props) => <AdminIcon name="AlertTriangle" {...props} />;
export const ArrowDownToLine = (props) => <AdminIcon name="ArrowDownToLine" {...props} />;
export const BarChart3 = (props) => <AdminIcon name="BarChart3" {...props} />;
export const Check = (props) => <AdminIcon name="Check" {...props} />;
export const CheckCircle2 = (props) => <AdminIcon name="CheckCircle2" {...props} />;
export const CircleHelp = (props) => <AdminIcon name="CircleHelp" {...props} />;
export const FileText = (props) => <AdminIcon name="FileText" {...props} />;
export const MessageSquare = (props) => <AdminIcon name="MessageSquare" {...props} />;
export const Pencil = (props) => <AdminIcon name="Pencil" {...props} />;
export const Plus = (props) => <AdminIcon name="Plus" {...props} />;
export const RefreshCw = (props) => <AdminIcon name="RefreshCw" {...props} />;
export const Search = (props) => <AdminIcon name="Search" {...props} />;
export const ShieldAlert = (props) => <AdminIcon name="ShieldAlert" {...props} />;
export const ShieldCheck = (props) => <AdminIcon name="ShieldCheck" {...props} />;
export const Trash2 = (props) => <AdminIcon name="Trash2" {...props} />;
export const Users = (props) => <AdminIcon name="Users" {...props} />;
export const X = (props) => <AdminIcon name="X" {...props} />;
export const Eye = (props) => <AdminIcon name="Eye" {...props} />;
export const EyeOff = (props) => <AdminIcon name="EyeOff" {...props} />;
export const ChevronRight = (props) => <AdminIcon name="ChevronRight" {...props} />;
export const LayoutDashboard = (props) => <AdminIcon name="LayoutDashboard" {...props} />;
export const Menu = (props) => <AdminIcon name="Menu" {...props} />;
export const LogOut = (props) => <AdminIcon name="LogOut" {...props} />;
export const Moon = (props) => <AdminIcon name="Moon" {...props} />;
export const Sun = (props) => <AdminIcon name="Sun" {...props} />;
