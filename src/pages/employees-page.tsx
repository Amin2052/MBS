import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
  Search,
  Eye,
  Pencil,
  Trash2,
  X,
  User,
  RefreshCw
} from "lucide-react";

import { formatDateShort } from "@/utils/date-format";
import { formatDuration } from "@/utils/duration";
import { formatNumber } from "@/utils/format-number";
import { useCurrency } from "@/hooks/use-currency";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";

import {
  EMPLOYEE_DEPARTMENTS,
  EMPLOYEE_DESIGNATIONS,
  EMPLOYEE_STATUS_OPTIONS,
  EMPLOYEE_GENDER_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  IDENTITY_TYPE_OPTIONS
} from "@/constants/employee";

import "./employees.css";

// Employee is declared globally in src/types/electron.d.ts.

type EmployeeForm = {
  first_name: string;
  last_name: string;
  gender: string;
  date_of_birth: string;
  phone: string;
  email: string;
  address: string;
  department: string;
  designation: string;
  joining_date: string;
  employment_status: string;
  employment_type: string;
  resignation_date: string;
  contract_start_date: string;
  contract_end_date: string;
  salary: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  identity_type: string;
  identity_number: string;
  notes: string;
};

function emptyForm(): EmployeeForm {
  return {
    first_name: "",
    last_name: "",
    gender: "",
    date_of_birth: "",
    phone: "",
    email: "",
    address: "",
    department: EMPLOYEE_DEPARTMENTS[0],
    designation: EMPLOYEE_DESIGNATIONS[0],
    joining_date: new Date().toISOString().slice(0, 10),
    employment_status: "Active",
    employment_type: EMPLOYMENT_TYPE_OPTIONS[0],
    resignation_date: "",
    contract_start_date: "",
    contract_end_date: "",
    salary: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    identity_type: "",
    identity_number: "",
    notes: ""
  };
}

const PHONE_PATTERN = /^[0-9+\-\s()]{6,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ==========================================================
// EMPLOYEE CERTIFICATE AUTOMATION
// ==========================================================
// The Employee module is the single owner of Employee Certificates --
// see saveEmployee()'s call to syncEmployeeCertificate() below. The
// Employee Certificate page (certificates-page.tsx) only displays and
// edits whatever this module has already created; it never generates,
// synchronizes, or decides which certificates exist.
//
// Employment Status drives everything:
//   - "Resigned" / "End of Contract": certificate is auto-created (or
//     updated if one already exists) with an auto-generated Title and
//     Description.
//   - "Terminated": certificate is auto-created/updated too, but Title
//     and Description are left exactly as they are (blank on first
//     creation) -- the user writes them manually from the Employee
//     Certificate page.
//   - Any other status: no certificate should be visible for this
//     employee, so an existing one (if any) is removed.

const EMPLOYEE_CERTIFICATE_STATUSES = ["Resigned", "End of Contract", "Terminated"];

function computeEmployeeCertificateType(employmentStatus: string): string {

  if (employmentStatus === "End of Contract") return "Contract Completion Certificate";
  if (employmentStatus === "Terminated") return "Relieving Certificate";

  // "Resigned"
  return "Experience Certificate";

}

/**
 * The certificate's own "as of" end date: the date service/contract
 * duration should be measured up to. Null means open-ended -- the
 * caller measures up to today instead (formatDuration's default).
 */
function getEmployeeCertificateEndDate(
  certificateType: string,
  employee: Employee
): string | null {

  if (certificateType === "Contract Completion Certificate") {
    return employee.contract_end_date || employee.resignation_date || null;
  }

  return employee.resignation_date || null;

}

function computeEmployeeCertificateTitle(certificateType: string): string {

  // Title must contain ONLY the certificate type -- duration belongs
  // exclusively in the Description (see
  // computeEmployeeCertificateDescription below), never in the Title.
  return certificateType;

}

/**
 * Employee Identity System: renders as ", holding Passport No. X," (or
 * Residence ID / Citizen ID) right after the employee's name in the
 * certificate body. Either piece missing simply omits the clause, so
 * older/incomplete employee records still produce a clean sentence.
 */
function formatEmployeeIdentityClause(
  identityType: string | null | undefined,
  identityNumber: string | null | undefined
): string {

  const type = (identityType || "").trim();
  const number = (identityNumber || "").trim();

  if (!type || !number) return "";

  return `, holding ${type} No. ${number},`;

}

function computeEmployeeCertificateDescription(
  certificateType: string,
  fullName: string,
  designation: string,
  joiningDate: string,
  endDate: string | null,
  identityType?: string | null,
  identityNumber?: string | null
): string {

  const duration = formatDuration(joiningDate, endDate ?? undefined);
  const fromText = formatDateShort(joiningDate);
  const toText = endDate ? formatDateShort(endDate) : "present";
  const identityClause = formatEmployeeIdentityClause(identityType, identityNumber);

  if (certificateType === "Contract Completion Certificate") {
    return `This certificate confirms that ${fullName}${identityClause} successfully completed a contract engagement as ${designation} with our organization from ${fromText} to ${toText}, a period of ${duration}. We appreciate the valuable contribution made during this contract period and wish ${fullName} continued success ahead.`;
  }

  if (certificateType === "Relieving Certificate") {
    return `This is to certify that ${fullName}${identityClause} has been relieved from the position of ${designation} in our organization, having served from ${fromText} to ${toText}, a period of ${duration}. All dues and formalities related to ${fullName}'s employment have been settled.`;
  }

  return `This is to certify that ${fullName}${identityClause} worked as ${designation} in our organization from ${fromText} to ${toText}, a period of ${duration}. During this period, ${fullName} demonstrated professionalism and dedication in all assigned responsibilities. We wish ${fullName} continued success in future endeavors.`;

}

/**
 * Creates, updates, or removes this employee's Employee Certificate to
 * match their current Employment Status, per the rules above. Called
 * after every successful Employee create/update -- this is the only
 * place Employee Certificates are generated or kept in sync; the
 * Employee Certificate page never does this itself.
 */
async function syncEmployeeCertificate(employeeId: number): Promise<void> {

  try {

    const emp = await window.mooral.employees.getById(employeeId);

    if (!emp) return;

    const status = emp.employment_status;

    const employeeCertificates = await window.mooral.certificates.getAll({ category: "Employee" });

    // Match on employee_id first (the natural key normally used), but
    // fall back to employee_number_snapshot so a certificate never ends
    // up "orphaned" (and re-created as a duplicate, leaving the old row
    // stuck showing outdated snapshot data in the list) if employee_id
    // wasn't populated for any reason.
    const existing = employeeCertificates.find(c =>
      c.employee_id === emp.employee_number ||
      c.employee_number_snapshot === emp.employee_number
    );

    if (!EMPLOYEE_CERTIFICATE_STATUSES.includes(status)) {

      // Not an eligible status -- the employee must not appear in the
      // Employee Certificate list.
      if (existing?.id) {
        await window.mooral.certificates.delete(existing.id);
      }

      return;

    }

    const fullName = `${emp.first_name} ${emp.last_name}`.trim();
    const certificateType = computeEmployeeCertificateType(status);

    // Terminated: Title/Description are left untouched -- blank on
    // first creation, preserved exactly as the user wrote them on any
    // later update.
    let title = existing?.title ?? "";
    let description = existing?.description ?? "";

    if (status !== "Terminated") {

      const endDate = getEmployeeCertificateEndDate(certificateType, emp);

      title = computeEmployeeCertificateTitle(certificateType);

      description = computeEmployeeCertificateDescription(
        certificateType,
        fullName,
        emp.designation || "",
        emp.joining_date || "",
        endDate,
        emp.identity_type,
        emp.identity_number
      );

    }

    const snapshot = {

      certificate_type: certificateType,
      customer_id: "",
      customer_name: "",
      employee_name: fullName,
      product_id: "",
      product_name: "",
      serial_number: "",
      title,
      description,
      issue_date: existing?.issue_date || new Date().toISOString(),
      expiry_date: existing?.expiry_date ?? null,
      status: existing?.status || "Active",
      employee_id: emp.employee_number,
      employee_number_snapshot: emp.employee_number,
      employee_name_snapshot: fullName,
      department_snapshot: emp.department || "",
      designation_snapshot: emp.designation || "",
      employment_type_snapshot: emp.employment_type || "",
      joining_date_snapshot: emp.joining_date || null,
      employment_status_snapshot: status,
      product_name_snapshot: "",
      category_snapshot: "",
      sku_snapshot: ""

    };

    if (existing?.id) {

      await window.mooral.certificates.update({
        id: existing.id,
        certificate: snapshot
      });

    }
    else {

      await window.mooral.certificates.create({
        certificate_category: "Employee",
        ...snapshot
      });

    }

  }
  catch (error) {

    console.error("Failed to sync employee certificate:", error);

  }

}

export default function EmployeesPage(): JSX.Element {

  const { hasPermission } = useAuth();
  const { t } = useLanguage();

  const [searchParams] = useSearchParams();

  const { format: formatCurrency } = useCurrency();

  const [employees, setEmployees] = useState<Employee[]>([]);

  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPickingPhoto, setIsPickingPhoto] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<EmployeeForm>(emptyForm());

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [pendingPhotoDataUrl, setPendingPhotoDataUrl] = useState<string | null | undefined>(undefined);

  const [rowPhotos, setRowPhotos] = useState<Record<number, string | null>>({});

  const [viewEmployee, setViewEmployee] = useState<Employee | null>(null);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);

  // Contract lifecycle -- current contract + full history for whichever
  // employee is open in the Add/Edit modal, plus the Extend Contract
  // dialog's own small bit of state. Loaded on demand (openEdit /
  // openAdd), never derived from the employees list itself.
  const [currentContract, setCurrentContract] = useState<EmployeeContract | null>(null);
  const [contractHistory, setContractHistory] = useState<EmployeeContract[]>([]);
  const [isLoadingContracts, setIsLoadingContracts] = useState(false);

  const [showExtendDialog, setShowExtendDialog] = useState(false);
  const [extendEndDate, setExtendEndDate] = useState("");
  const [extendReason, setExtendReason] = useState("");
  const [isExtending, setIsExtending] = useState(false);

  async function loadEmployees() {

    setIsLoading(true);

    try {

      const data = await window.mooral.employees.getAll();
      setEmployees(data);

    }
    catch (error) {

      console.error("Failed to load employees:", error);

    }
    finally {

      setIsLoading(false);

    }

  }

  useEffect(() => {

    loadEmployees();

  }, []);

  // Deep-link support: /employees?id=123, same ?id= convention used by
  // Customers/Products/Orders/Certificates.
  useEffect(() => {

    const idParam = searchParams.get("id");

    if (!idParam) return;

    const id = Number(idParam);

    const existing = employees.find(e => e.id === id);

    if (existing) {
      openView(existing);
    }
    else if (employees.length > 0) {

      window.mooral.employees.getById(id).then(emp => {

        if (emp) openView(emp);

      }).catch(error => {

        console.error("Failed to load linked employee:", error);

      });

    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, employees]);

  const filteredEmployees = useMemo(() => {

    const keyword = search.trim().toLowerCase();

    return employees.filter(emp => {

      if (departmentFilter !== "All" && emp.department !== departmentFilter) return false;
      if (statusFilter !== "All" && emp.employment_status !== statusFilter) return false;

      if (!keyword) return true;

      return (
        (emp.employee_number || "").toLowerCase().includes(keyword) ||
        `${emp.first_name} ${emp.last_name}`.toLowerCase().includes(keyword) ||
        (emp.phone || "").toLowerCase().includes(keyword) ||
        (emp.email || "").toLowerCase().includes(keyword) ||
        (emp.designation || "").toLowerCase().includes(keyword)
      );

    });

  }, [employees, departmentFilter, statusFilter, search]);

  // Lazily fetch thumbnail photos only for employees not yet cached,
  // same lazy-preview approach the Company Logo already uses
  // (settings:getLogoPreview) -- avoids shipping every employee's photo
  // blob over IPC on every list load.
  useEffect(() => {

    let cancelled = false;

    filteredEmployees.forEach(emp => {

      if (!emp.id || !emp.has_photo || rowPhotos[emp.id] !== undefined) {
        return;
      }

      window.mooral.employees.getPhotoPreview(emp.id).then(preview => {

        if (!cancelled) {
          setRowPhotos(prev => ({ ...prev, [emp.id as number]: preview }));
        }

      }).catch(error => {

        console.error("Failed to load employee photo preview:", error);

      });

    });

    return () => { cancelled = true; };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEmployees]);

  function openAdd() {

    setEditId(null);
    setForm(emptyForm());
    setPhotoPreview(null);
    setPendingPhotoDataUrl(undefined);
    setCurrentContract(null);
    setContractHistory([]);
    setShowModal(true);

  }

  async function loadContracts(employeeId: number) {

    setIsLoadingContracts(true);

    try {

      const [current, history] = await Promise.all([
        window.mooral.employeeContracts.getCurrent(employeeId),
        window.mooral.employeeContracts.getByEmployee(employeeId)
      ]);

      setCurrentContract(current ?? null);
      setContractHistory(history);

    }
    catch (error) {

      console.error("Failed to load contract details:", error);
      setCurrentContract(null);
      setContractHistory([]);

    }
    finally {

      setIsLoadingContracts(false);

    }

  }

  async function openEdit(emp: Employee) {

    setEditId(emp.id ?? null);

    setForm({
      first_name: emp.first_name || "",
      last_name: emp.last_name || "",
      gender: emp.gender || "",
      date_of_birth: emp.date_of_birth ? emp.date_of_birth.slice(0, 10) : "",
      phone: emp.phone || "",
      email: emp.email || "",
      address: emp.address || "",
      department: emp.department || EMPLOYEE_DEPARTMENTS[0],
      designation: emp.designation || EMPLOYEE_DESIGNATIONS[0],
      joining_date: emp.joining_date ? emp.joining_date.slice(0, 10) : "",
      employment_status: emp.employment_status || "Active",
      employment_type: emp.employment_type || EMPLOYMENT_TYPE_OPTIONS[0],
      resignation_date: emp.resignation_date ? emp.resignation_date.slice(0, 10) : "",
      contract_start_date: emp.contract_start_date ? emp.contract_start_date.slice(0, 10) : "",
      contract_end_date: emp.contract_end_date ? emp.contract_end_date.slice(0, 10) : "",
      salary: emp.salary ? String(emp.salary) : "",
      emergency_contact_name: emp.emergency_contact_name || "",
      emergency_contact_phone: emp.emergency_contact_phone || "",
      identity_type: emp.identity_type || "",
      identity_number: emp.identity_number || "",
      notes: emp.notes || ""
    });

    setPendingPhotoDataUrl(undefined);
    setCurrentContract(null);
    setContractHistory([]);

    if (emp.has_photo && emp.id) {

      try {
        const preview = await window.mooral.employees.getPhotoPreview(emp.id);
        setPhotoPreview(preview);
      }
      catch (error) {
        console.error("Failed to load employee photo:", error);
        setPhotoPreview(null);
      }

    }
    else {

      setPhotoPreview(null);

    }

    if (emp.id) {
      await loadContracts(emp.id);
    }

    setShowModal(true);

  }

  async function openView(emp: Employee) {

    setViewEmployee(emp);
    setViewPhoto(null);

    if (emp.has_photo && emp.id) {

      try {
        const preview = await window.mooral.employees.getPhotoPreview(emp.id);
        setViewPhoto(preview);
      }
      catch (error) {
        console.error("Failed to load employee photo:", error);
      }

    }

  }

  function closeView() {

    setViewEmployee(null);
    setViewPhoto(null);

  }

  async function handlePickPhoto() {

    setIsPickingPhoto(true);

    try {

      const picked = await window.mooral.employees.pickPhoto();

      if (picked) {
        setPhotoPreview(picked.dataUrl);
        setPendingPhotoDataUrl(picked.dataUrl);
      }

    }
    catch (error) {

      console.error("Failed to pick employee photo:", error);
      window.alert(t("employees.photoPickerFailed"));

    }
    finally {

      setIsPickingPhoto(false);

    }

  }

  function handleRemovePhoto() {

    setPhotoPreview(null);
    setPendingPhotoDataUrl(null);

  }

  function validateForm(): string | null {

    if (!form.first_name.trim()) return t("employees.firstNameRequired");
    if (!form.last_name.trim()) return t("employees.lastNameRequired");

    if (!form.phone.trim()) return t("employees.phoneRequired");
    if (!PHONE_PATTERN.test(form.phone.trim())) return t("employees.phoneInvalid");

    if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) return t("employees.emailInvalid");

    if (!(EMPLOYEE_DEPARTMENTS as readonly string[]).includes(form.department)) return t("employees.departmentInvalid");
    if (!(EMPLOYEE_DESIGNATIONS as readonly string[]).includes(form.designation)) return t("employees.designationInvalid");

    if (form.salary.trim()) {

      const salaryValue = Number(form.salary);

      if (Number.isNaN(salaryValue) || salaryValue < 0) return t("employees.salaryInvalid");

    }

    if (form.date_of_birth) {

      const dob = new Date(form.date_of_birth);

      if (Number.isNaN(dob.getTime())) return t("employees.dobInvalid");
      if (dob.getTime() > Date.now()) return t("employees.dobFuture");

    }

    if (
      form.emergency_contact_phone.trim() &&
      !PHONE_PATTERN.test(form.emergency_contact_phone.trim())
    ) {
      return t("employees.emergencyPhoneInvalid");
    }

    if (form.employment_type === "Contract" && !currentContract) {

      if (!form.contract_start_date) return t("employees.contractStartRequired");

      if (form.contract_end_date) {

        const start = new Date(form.contract_start_date);
        const end = new Date(form.contract_end_date);

        if (Number.isNaN(end.getTime())) return t("employees.contractEndInvalid");
        if (end.getTime() < start.getTime()) return t("employees.contractEndBeforeStart");

      }

    }

    return null;

  }

  async function saveEmployee() {

    const validationError = validateForm();

    if (validationError) {
      window.alert(validationError);
      return;
    }

    // Prevent a fast double-click (or a slow IPC round trip) from
    // submitting the same employee twice.
    if (isSubmitting) {
      return;
    }

    const payload = {

      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      gender: form.gender,
      date_of_birth: form.date_of_birth ? new Date(form.date_of_birth).toISOString() : null,
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      department: form.department,
      designation: form.designation,
      joining_date: form.joining_date ? new Date(form.joining_date).toISOString() : null,
      employment_status: form.employment_status,
      employment_type: form.employment_type,
      resignation_date: form.resignation_date ? new Date(form.resignation_date).toISOString() : null,
      contract_start_date: form.contract_start_date ? new Date(form.contract_start_date).toISOString() : null,
      contract_end_date: form.contract_end_date ? new Date(form.contract_end_date).toISOString() : null,
      salary: form.salary.trim() ? Number(form.salary) : 0,
      emergency_contact_name: form.emergency_contact_name.trim(),
      emergency_contact_phone: form.emergency_contact_phone.trim(),
      identity_type: form.identity_type,
      identity_number: form.identity_number.trim(),
      notes: form.notes.trim(),
      photo_data_url: pendingPhotoDataUrl,
      remove_photo: pendingPhotoDataUrl === null

    };

    setIsSubmitting(true);

    try {

      let employeeId = editId;

      if (editId) {

        await window.mooral.employees.update({
          id: editId,
          employee: payload
        });

      }
      else {

        const created = await window.mooral.employees.create(payload);
        employeeId = created.id;

      }

      // First-time Contract setup: no employee_contracts row exists yet
      // for this employee (brand-new employee, or an existing one whose
      // Employment Type is only now being switched to Contract) -- open
      // one from the Contract Start/End Date fields on the form. Once a
      // current contract exists, those fields become read-only and any
      // change instead goes through the Extend Contract dialog, which
      // never touches this path.
      if (
        employeeId &&
        form.employment_type === "Contract" &&
        !currentContract &&
        form.contract_start_date
      ) {

        await window.mooral.employeeContracts.create({
          employee_id: employeeId,
          contract_start_date: new Date(form.contract_start_date).toISOString(),
          contract_end_date: form.contract_end_date ? new Date(form.contract_end_date).toISOString() : null
        });

      }

      // Employee Certificate automation: the Employee module owns
      // Employee Certificates entirely -- create/update/remove them to
      // match this employee's saved Employment Status. See
      // syncEmployeeCertificate() above.
      if (employeeId) {
        await syncEmployeeCertificate(employeeId);
      }

      setShowModal(false);

      if (editId) {
        setRowPhotos(prev => {
          const next = { ...prev };
          delete next[editId];
          return next;
        });
      }

      await loadEmployees();

    }
    catch (error) {

      console.error("Failed to save employee:", error);

      window.alert(
        error instanceof Error
          ? error.message
          : t("employees.saveFailed")
      );

      return;

    }
    finally {

      setIsSubmitting(false);

    }

  }

  async function removeEmployee(id: number) {

    if (!window.confirm(t("employees.confirmDelete"))) return;

    try {

      await window.mooral.employees.delete(id);
      await loadEmployees();

      if (viewEmployee?.id === id) {
        closeView();
      }

    }
    catch (error) {

      console.error("Failed to delete employee:", error);

      window.alert(
        error instanceof Error
          ? error.message
          : t("employees.deleteFailed")
      );

    }

  }

  function openExtendDialog() {

    setExtendEndDate(currentContract?.contract_end_date ? currentContract.contract_end_date.slice(0, 10) : "");
    setExtendReason("");
    setShowExtendDialog(true);

  }

  async function submitExtendContract() {

    const contract = currentContract;

    if (!contract || !contract.id) return;

    if (!extendEndDate) {
      window.alert(t("employees.contractEndDateRequired"));
      return;
    }

    if (new Date(extendEndDate).getTime() < new Date(contract.contract_start_date).getTime()) {
      window.alert(t("employees.contractEndDateBeforeStart"));
      return;
    }

    if (!extendReason.trim()) {
      window.alert(t("employees.extensionReasonRequired"));
      return;
    }

    setIsExtending(true);

    try {

      await window.mooral.employeeContracts.extend({
        contract_id: contract.id,
        contract_end_date: new Date(extendEndDate).toISOString(),
        extension_reason: extendReason.trim()
      });

      setShowExtendDialog(false);

      if (editId) {
        await loadContracts(editId);
        await loadEmployees();
      }

    }
    catch (error) {

      console.error("Failed to extend contract:", error);

      window.alert(
        error instanceof Error
          ? error.message
          : t("employees.extendContractFailed")
      );

    }
    finally {

      setIsExtending(false);

    }

  }

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="employees-page">

      <div className="employees-header">
        <div>
          <h1>{t("employees.title")}</h1>
          <p>Manage your team's records, roles, and employment details</p>
        </div>

        {hasPermission("employees.create") && (
        <button className="add-employee-btn" onClick={openAdd}>
          <Plus size={18} />
          {t("employees.addEmployee")}
        </button>
        )}
      </div>

      <div className="employees-toolbar">

        <div className="search-box">
          <Search size={18} />
          <input
            placeholder="Search by employee number, name, phone, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
          <option value="All">{t("employees.allDepartments")}</option>
          {EMPLOYEE_DEPARTMENTS.map(dept => (
            <option key={dept} value={dept}>{dept}</option>
          ))}
        </select>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">{t("employees.allStatus")}</option>
          {EMPLOYEE_STATUS_OPTIONS.map(status => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>

      </div>

      <div className="employees-table">

        <div className="employee-row employee-row-header">
          <span>{t("employees.photo")}</span>
          <span>{t("employees.employeeNo")}</span>
          <span>{t("employees.name")}</span>
          <span>{t("employees.department")}</span>
          <span>{t("employees.designation")}</span>
          <span>{t("employees.status")}</span>
          <span>{t("employees.actions")}</span>
        </div>

        <div className="employees-table-body table-scroll-body">

        {isLoading && (
          <div className="employee-empty">Loading employees…</div>
        )}

        {!isLoading && filteredEmployees.length === 0 && (
          <div className="employee-empty">{t("employees.noEmployeesFound")}</div>
        )}

        {!isLoading && filteredEmployees.map(emp => (
          <div className="employee-row" key={emp.id ?? emp.employee_number}>

            <span className="employee-photo-cell">
              {emp.id && rowPhotos[emp.id] ? (
                <img src={rowPhotos[emp.id] as string} alt={`${emp.first_name} ${emp.last_name}`} />
              ) : (
                <span className="employee-photo-placeholder"><User size={16} /></span>
              )}
            </span>

            <span className="employee-id-cell" onClick={() => openView(emp)}>
              {emp.employee_number}
            </span>

            <span>{emp.first_name} {emp.last_name}</span>
            <span>{emp.department}</span>
            <span>{emp.designation}</span>

            <span className={`employee-status status-${(emp.employment_status || "").toLowerCase().replace(/\s+/g, "-")}`}>
              {emp.employment_status}
            </span>

            <span className="employee-actions">
              <button className="icon-action-btn" title="View" onClick={() => openView(emp)}>
                <Eye size={16} />
              </button>
              {hasPermission("employees.edit") && (
              <button className="icon-action-btn" title="Edit" onClick={() => openEdit(emp)}>
                <Pencil size={16} />
              </button>
              )}
              {hasPermission("employees.delete") && (
              <button className="icon-action-btn danger" title="Delete" onClick={() => emp.id && removeEmployee(emp.id)}>
                <Trash2 size={16} />
              </button>
              )}
            </span>

          </div>
        ))}

        </div>

      </div>

      {showModal && (
        <div className="employee-modal-overlay">
          <div className="employee-modal" onClick={(e) => e.stopPropagation()}>

            <h2>{editId ? "Edit" : "New"} Employee</h2>

            <div className="employee-photo-section">

              <div className="employee-photo-box">
                {photoPreview
                  ? <img src={photoPreview} alt="Employee" />
                  : <span className="employee-photo-empty"><User size={28} /></span>}
              </div>

              <div className="employee-photo-actions">
                <button
                  type="button"
                  className="photo-action-btn"
                  onClick={handlePickPhoto}
                  disabled={isPickingPhoto || isSubmitting}
                >
                  {isPickingPhoto ? "Uploading…" : "Upload Photo"}
                </button>

                {photoPreview && (
                  <button
                    type="button"
                    className="photo-action-btn danger"
                    onClick={handleRemovePhoto}
                    disabled={isPickingPhoto || isSubmitting}
                  >
                    {t("employees.removePhoto")}
                  </button>
                )}
              </div>

            </div>

            <div className="employee-form-section">
              <h3>{t("employees.basicInformation")}</h3>

              <div className="form-grid">

                <div className="form-group">
                  <label>First Name *</label>
                  <input
                    value={form.first_name}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Last Name *</label>
                  <input
                    value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                  />
                </div>

              </div>

              <div className="form-grid">

                <div className="form-group">
                  <label>{t("employees.gender")}</label>
                  <select
                    value={form.gender}
                    onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  >
                    <option value="">{t("employees.selectGender")}</option>
                    {EMPLOYEE_GENDER_OPTIONS.map(gender => (
                      <option key={gender} value={gender}>{gender}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>{t("employees.dateOfBirth")}</label>
                  <input
                    type="date"
                    value={form.date_of_birth}
                    onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
                  />
                </div>

              </div>

              <div className="employee-form-row">
                <div className="form-group">
                  <label>{t("employees.identityType")}</label>
                  <select
                    value={form.identity_type}
                    onChange={(e) => setForm({ ...form, identity_type: e.target.value })}
                  >
                    <option value="">{t("employees.selectIdentityType")}</option>
                    {IDENTITY_TYPE_OPTIONS.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>{t("employees.identityNumber")}</label>
                  <input
                    value={form.identity_number}
                    onChange={(e) => setForm({ ...form, identity_number: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="employee-form-section">
              <h3>{t("employees.contactInformation")}</h3>

              <div className="form-grid">

                <div className="form-group">
                  <label>Phone *</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>{t("employees.email")}</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>

              </div>

              <div className="form-group">
                <label>{t("employees.address")}</label>
                <textarea
                  rows={2}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>

              <div className="form-grid">

                <div className="form-group">
                  <label>{t("employees.emergencyContactName")}</label>
                  <input
                    value={form.emergency_contact_name}
                    onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>{t("employees.emergencyContactPhone")}</label>
                  <input
                    value={form.emergency_contact_phone}
                    onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })}
                  />
                </div>

              </div>
            </div>

            <div className="employee-form-section">
              <h3>{t("employees.employmentInformation")}</h3>

              <div className="form-grid">

                <div className="form-group">
                  <label>Department *</label>
                  <select
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                  >
                    {EMPLOYEE_DEPARTMENTS.map(dept => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Designation *</label>
                  <select
                    value={form.designation}
                    onChange={(e) => setForm({ ...form, designation: e.target.value })}
                  >
                    {EMPLOYEE_DESIGNATIONS.map(designation => (
                      <option key={designation} value={designation}>{designation}</option>
                    ))}
                  </select>
                </div>

              </div>

              <div className="form-grid">

                <div className="form-group">
                  <label>{t("employees.joiningDate")}</label>
                  <input
                    type="date"
                    value={form.joining_date}
                    onChange={(e) => setForm({ ...form, joining_date: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>{t("employees.employmentStatus")}</label>
                  <select
                    value={form.employment_status}
                    onChange={(e) => setForm({ ...form, employment_status: e.target.value })}
                  >
                    {EMPLOYEE_STATUS_OPTIONS.map(status => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>

              </div>

              <div className="form-grid">

                <div className="form-group">
                  <label>{t("employees.employmentType")}</label>
                  <select
                    value={form.employment_type}
                    onChange={(e) => setForm({ ...form, employment_type: e.target.value })}
                  >
                    {EMPLOYMENT_TYPE_OPTIONS.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>{t("employees.resignationDate")}</label>
                  <input
                    type="date"
                    value={form.resignation_date}
                    onChange={(e) => setForm({ ...form, resignation_date: e.target.value })}
                  />
                </div>

              </div>

              <div className="form-group">
                <label>{t("employees.salary")}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.salary}
                  onChange={(e) => setForm({ ...form, salary: e.target.value })}
                />
              </div>
            </div>

            {form.employment_type === "Contract" && (
              <div className="employee-form-section">
                <h3>{t("employees.contract")}</h3>

                {isLoadingContracts && (
                  <p className="contract-loading">Loading contract details…</p>
                )}

                {!isLoadingContracts && !currentContract && (
                  <>
                    <div className="form-grid">

                      <div className="form-group">
                        <label>Contract Start *</label>
                        <input
                          type="date"
                          value={form.contract_start_date}
                          onChange={(e) => setForm({ ...form, contract_start_date: e.target.value })}
                        />
                      </div>

                      <div className="form-group">
                        <label>{t("employees.contractEnd")}</label>
                        <input
                          type="date"
                          value={form.contract_end_date}
                          onChange={(e) => setForm({ ...form, contract_end_date: e.target.value })}
                        />
                      </div>

                    </div>

                    {!editId && (
                      <p className="contract-hint">Saving will open this employee's first contract.</p>
                    )}
                  </>
                )}

                {!isLoadingContracts && currentContract && (
                  <>
                    <div className="employee-view-grid contract-summary-grid">
                      <div><span>{t("employees.contractStart")}</span><strong>{formatDateShort(currentContract.contract_start_date)}</strong></div>
                      <div><span>{t("employees.contractEnd")}</span><strong>{formatDateShort(currentContract.contract_end_date)}</strong></div>
                      <div><span>{t("employees.contractDuration")}</span><strong>{formatDuration(currentContract.contract_start_date, currentContract.contract_end_date) || "-"}</strong></div>
                      <div>
                        <span>{t("employees.status")}</span>
                        <strong>
                          <span className={`contract-status contract-status-${(currentContract.contract_status || "").toLowerCase().replace(/\s+/g, "-")}`}>
                            {currentContract.contract_status}
                          </span>
                        </strong>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="photo-action-btn"
                      onClick={openExtendDialog}
                    >
                      <RefreshCw size={14} />
                      {t("employees.extendContract")}
                    </button>
                  </>
                )}

                {contractHistory.length > 0 && (
                  <div className="contract-history">
                    <h4>{t("employees.contractHistory")}</h4>

                    <div className="contract-history-table">

                      <div className="contract-history-row contract-history-header">
                        <span>{t("employees.start")}</span>
                        <span>{t("employees.end")}</span>
                        <span>{t("employees.status")}</span>
                        <span>{t("employees.extensionReason")}</span>
                      </div>

                      {contractHistory.map(contract => (
                        <div className="contract-history-row" key={contract.id}>
                          <span>{formatDateShort(contract.contract_start_date)}</span>
                          <span>{formatDateShort(contract.contract_end_date)}</span>
                          <span className={`contract-status contract-status-${(contract.contract_status || "").toLowerCase().replace(/\s+/g, "-")}`}>
                            {contract.contract_status}{contract.is_current ? " (Current)" : ""}
                          </span>
                          <span>{contract.extension_reason || "-"}</span>
                        </div>
                      ))}

                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="employee-form-section">
              <h3>{t("employees.notes")}</h3>

              <div className="form-group">
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>

            <div className="employee-modal-actions">
              <button className="cancel-btn" onClick={() => setShowModal(false)} disabled={isSubmitting}>
                <X size={16} />
                {t("common.cancel")}
              </button>
              <button className="save-btn" onClick={saveEmployee} disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : t("employees.saveEmployee")}
              </button>
            </div>

          </div>
        </div>
      )}

      {viewEmployee && (
        <div className="employee-modal-overlay">
          <div className="employee-modal" onClick={(e) => e.stopPropagation()}>

            <div className="employee-view-header">

              <div className="employee-photo-box">
                {viewPhoto
                  ? <img src={viewPhoto} alt={`${viewEmployee.first_name} ${viewEmployee.last_name}`} />
                  : <span className="employee-photo-empty"><User size={28} /></span>}
              </div>

              <div>
                <h2>{viewEmployee.first_name} {viewEmployee.last_name}</h2>
                <p className="employee-view-subtitle">{viewEmployee.employee_number} · {viewEmployee.designation}</p>
              </div>

            </div>

            <div className="employee-view-grid">
              <div><span>{t("employees.department")}</span><strong>{viewEmployee.department}</strong></div>
              <div><span>{t("employees.designation")}</span><strong>{viewEmployee.designation}</strong></div>
              <div><span>{t("employees.status")}</span><strong>{viewEmployee.employment_status}</strong></div>
              <div><span>{t("employees.employmentType")}</span><strong>{viewEmployee.employment_type || "-"}</strong></div>
              <div><span>{t("employees.gender")}</span><strong>{viewEmployee.gender || "-"}</strong></div>
              <div><span>{t("employees.dateOfBirth")}</span><strong>{formatDateShort(viewEmployee.date_of_birth)}</strong></div>
              <div><span>{t("employees.joiningDate")}</span><strong>{formatDateShort(viewEmployee.joining_date)}</strong></div>
              <div><span>{t("employees.resignationDate")}</span><strong>{formatDateShort(viewEmployee.resignation_date)}</strong></div>
              {viewEmployee.employment_type === "Contract" && (
                <>
                  <div><span>{t("employees.contractStart")}</span><strong>{formatDateShort(viewEmployee.contract_start_date)}</strong></div>
                  <div><span>{t("employees.contractEnd")}</span><strong>{formatDateShort(viewEmployee.contract_end_date)}</strong></div>
                </>
              )}
              <div><span>{t("employees.phone")}</span><strong>{viewEmployee.phone}</strong></div>
              <div><span>{t("employees.email")}</span><strong>{viewEmployee.email || "-"}</strong></div>
              <div><span>{t("employees.address")}</span><strong>{viewEmployee.address || "-"}</strong></div>
              <div><span>{t("employees.identityType")}</span><strong>{viewEmployee.identity_type && viewEmployee.identity_number ? `${viewEmployee.identity_type} - ${viewEmployee.identity_number}` : "-"}</strong></div>
              <div><span>{t("employees.salary")}</span><strong>{formatCurrency(viewEmployee.salary || 0)}</strong></div>
              <div><span>{t("employees.emergencyContactName")}</span><strong>{viewEmployee.emergency_contact_name || "-"}</strong></div>
              <div><span>{t("employees.emergencyContactPhone")}</span><strong>{viewEmployee.emergency_contact_phone || "-"}</strong></div>
            </div>

            {viewEmployee.notes && (
              <p className="employee-view-description">{viewEmployee.notes}</p>
            )}

            <div className="employee-modal-actions">
              <button className="cancel-btn" onClick={closeView}>
                <X size={16} />
                {t("common.close")}
              </button>
              {hasPermission("employees.edit") && (
              <button className="save-btn" onClick={() => { closeView(); openEdit(viewEmployee); }}>
                <Pencil size={16} />
                {t("common.edit")}
              </button>
              )}
            </div>

          </div>
        </div>
      )}

      {showExtendDialog && currentContract && (
        <div className="employee-modal-overlay">
          <div className="employee-modal contract-extend-modal" onClick={(e) => e.stopPropagation()}>

            <h2>{t("employees.extendContract")}</h2>

            <div className="form-group">
              <label>{t("employees.currentContractEnd")}</label>
              <input type="date" value={currentContract.contract_end_date ? currentContract.contract_end_date.slice(0, 10) : ""} disabled />
            </div>

            <div className="form-group">
              <label>New End Date *</label>
              <input
                type="date"
                value={extendEndDate}
                onChange={(e) => setExtendEndDate(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Extension Reason *</label>
              <textarea
                rows={3}
                value={extendReason}
                onChange={(e) => setExtendReason(e.target.value)}
              />
            </div>

            <div className="employee-modal-actions">
              <button className="cancel-btn" onClick={() => setShowExtendDialog(false)} disabled={isExtending}>
                <X size={16} />
                {t("common.cancel")}
              </button>
              <button className="save-btn" onClick={submitExtendContract} disabled={isExtending}>
                {isExtending ? t("employees.extending") : t("employees.extendContract")}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );

}
