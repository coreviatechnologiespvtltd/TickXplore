import type { ReactNode, ReactElement } from "react";

interface AdminPageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactElement;
  action?: ReactNode;
  children?: ReactNode;
}

const AdminPageHeader = ({ title, subtitle, icon, action, children }: AdminPageHeaderProps) => (
  <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-indigo-600 p-6 text-white shadow-card">
    <div className="flex items-center gap-3">
      {icon && <span className="inline-flex p-2 bg-white/20 rounded-xl">{icon}</span>}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-indigo-100">{subtitle}</p>}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      {action}
      {children}
    </div>
  </div>
);

export default AdminPageHeader;