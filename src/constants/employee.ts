// ===================================================================
// EMPLOYEE MODULE CONSTANTS
// ===================================================================
//
// Department and Designation are deliberately fixed dropdowns (no
// database table, no free text) -- see employee-repository.ts, which
// validates incoming values against these exact lists.
//
// The Employee Number prefix is a plain constant for now, but is kept
// isolated here (and read through its own getter in
// employee-repository.ts) so a future "Employee Number Prefix" setting
// -- mirroring certificate_employee_prefix / certificate_product_prefix
// in company_settings -- can be wired in later without touching the
// numbering logic itself or any call site.

export const DEFAULT_EMPLOYEE_NUMBER_PREFIX = "EMP-";

export const EMPLOYEE_DEPARTMENTS = [
  "Administration",
  "Human Resources",
  "Finance & Accounting",
  "Sales",
  "Marketing",
  "Operations",
  "Customer Support",
  "IT / Technical",
  "Procurement",
  "Warehouse & Inventory",
  "Production",
  "Logistics",
  "Quality Assurance",
  "Research & Development",
  "Legal",
  "Other"
] as const;

export const EMPLOYEE_DESIGNATIONS = [
  "Chief Executive Officer",
  "Managing Director",
  "General Manager",
  "Manager",
  "Assistant Manager",
  "Team Lead",
  "Senior Executive",
  "Executive",
  "Junior Executive",
  "Senior Officer",
  "Officer",
  "Supervisor",
  "Coordinator",
  "Specialist",
  "Technician",
  "Accountant",
  "Sales Representative",
  "Customer Support Representative",
  "Intern",
  "Other"
] as const;

export const EMPLOYEE_STATUS_OPTIONS = [
  "Active",
  "Inactive",
  "On Leave",
  "Suspended",
  "Resigned",
  "Terminated",
  "End of Contract"
] as const;

export const EMPLOYEE_GENDER_OPTIONS = [
  "Male",
  "Female",
  "Other"
] as const;

// employment_type: Full Time / Part Time / Contract / Temporary /
// Intern / Freelancer -- drives the Contract section on the
// Employee Add/Edit form (see employees-page.tsx): only shown when
// the selected value is "Contract".
export const EMPLOYMENT_TYPE_OPTIONS = [
  "Full Time",
  "Part Time",
  "Contract",
  "Temporary",
  "Intern",
  "Freelancer"
] as const;

// identity_type: the document type behind identity_number (Employee
// Identity System). Drives both the Identity Type dropdown in
// employees-page.tsx and the "holding <type> No. <number>" clause
// auto-generated into Experience Certificate descriptions.
export const IDENTITY_TYPE_OPTIONS = [
  "Passport",
  "Residence ID",
  "Citizen ID"
] as const;

export type EmployeeDepartment = typeof EMPLOYEE_DEPARTMENTS[number];
export type EmployeeDesignation = typeof EMPLOYEE_DESIGNATIONS[number];
export type EmployeeStatus = typeof EMPLOYEE_STATUS_OPTIONS[number];
export type EmployeeGender = typeof EMPLOYEE_GENDER_OPTIONS[number];
export type EmployeeEmploymentType = typeof EMPLOYMENT_TYPE_OPTIONS[number];
export type EmployeeIdentityType = typeof IDENTITY_TYPE_OPTIONS[number];
