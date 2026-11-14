import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import {
  Plus,
  Search,
  Eye,
  Pencil,
  Trash2,
  Printer,
  FileDown,
  X
} from "lucide-react";

import { useEscapeKey } from "@/hooks/use-escape-key";

import { getCompanySettings } from "@/services/company-settings-service";
import { formatDateShort } from "@/utils/date-format";
import type { CompanySettings } from "@/types/company-settings";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { renderEmployeeCertificateHtml } from "@/pdf/templates/employee-certificate-template";
import { renderProductCertificateHtml } from "@/pdf/templates/product-certificate-template";
import { MOORAL_LOGO_DATA_URL } from "@/assets/mooral-logo-data-url";
import { showPrintPreview, buildPrintDocumentLabel } from "@/utils/print-window";

import "./certificates.css";

// Customer, Product and Employee are declared globally in
// src/types/electron.d.ts. Certificate is declared globally too
// (certificate_category/type, employee_name, product/customer linkage,
// serial_number, and the Task 9 + Certificate Automation snapshot
// fields).

// Employee Certificate status badges (Task: automatic Pending -> Printed)
// show a time alongside formatDateShort's date -- a small local
// formatter is enough for that and keeps this change contained to
// this file.
function formatPrintTime(value: string | null | undefined): string {

  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(date);

}

const PRODUCT_CERT_TYPES = [
  "Product Certificate",
  "Warranty Certificate",
  "Installation Certificate",
  "Calibration Certificate",
  "Service Certificate"
];

const STATUS_OPTIONS = ["Active", "Expired", "Revoked"];

// Employee Certificates are entirely owned by the Employee module (see
// employees-page.tsx) -- this page never generates, synchronizes, or
// decides which Employee Certificates exist. It only displays and
// (for Terminated employees) edits the Title/Description of
// certificates the Employee module has already created.

// ==========================================================
// CERTIFICATE AUTOMATION (Product certificates)
// ==========================================================
// Task 9: Certificate Type (still manually selected from the
// PRODUCT_CERT_TYPES dropdown) + the selected Product's snapshot data
// + Issue/Expiry Date drive an auto-generated Title and Description,
// mirroring the Employee automation above. Centralized here so every
// trigger (product selection, certificate type change, date changes --
// see handleProductChange / handleProductCertificateTypeChange /
// handleProductDateChange below) reuses the exact same generation
// logic instead of duplicating it inline.
//
// Per the Expiry Date Rule: the Expiry Date used below always comes
// from the certificate form's own Expiry Date field -- never from the
// Product database, which has no expiry concept of its own.

function computeProductCertificateTitle(certificateType: string): string {

  switch (certificateType) {

    case "Warranty Certificate": return "Product Warranty Certificate";
    case "Installation Certificate": return "Product Installation Certificate";
    case "Calibration Certificate": return "Product Calibration Certificate";
    case "Service Certificate": return "Product Service Certificate";
    default: return "Product Certificate";

  }

}

function computeProductCertificateDescription(
  certificateType: string,
  productName: string,
  issueDate: string,
  expiryDate: string | null
): string {

  if (!productName) return "";

  const issueText = issueDate ? formatDateShort(issueDate) : "";
  const expiryText = expiryDate ? formatDateShort(expiryDate) : "";

  switch (certificateType) {

    case "Warranty Certificate":
      return expiryText
        ? `This certificate confirms warranty coverage for ${productName} until ${expiryText}.`
        : `This certificate confirms warranty coverage for ${productName}, issued on ${issueText}.`;

    case "Installation Certificate":
      return `This certificate confirms that ${productName} was successfully installed and commissioned on ${issueText}.${expiryText ? ` This certificate remains valid until ${expiryText}.` : ""}`;

    case "Calibration Certificate":
      return expiryText
        ? `This certificate confirms that ${productName} has been calibrated and certified accurate, valid until ${expiryText}.`
        : `This certificate confirms that ${productName} has been calibrated and certified accurate as of ${issueText}.`;

    case "Service Certificate":
      return `This certificate confirms that servicing for ${productName} was completed on ${issueText}.${expiryText ? ` Next service is due by ${expiryText}.` : ""}`;

    default:
      return expiryText
        ? `This certificate confirms that ${productName} meets the required quality and compliance standards, valid until ${expiryText}.`
        : `This certificate confirms that ${productName} meets the required quality and compliance standards, issued on ${issueText}.`;

  }

}

type CertificateForm = {
  certificate_type: string;
  customer_id: string;
  customer_name: string;
  employee_name: string;
  product_id: string;
  product_name: string;
  serial_number: string;
  title: string;
  description: string;
  issue_date: string;
  expiry_date: string;
  status: string;
  // Populated (read-only) from the certificate record so the Employee
  // Status badge can show a "Printed" timestamp in the edit form too.
  printed_at: string;
  // Task 9: Employee/Product database-driven selection. employee_id
  // holds the selected employee's employee_number (the same "external
  // key as select value" convention already used for customer_id /
  // product_id above). The *_snapshot fields are read-only, auto
  // populated from the selected record and are never hand-typed.
  employee_id: string;
  employee_number_snapshot: string;
  employee_name_snapshot: string;
  department_snapshot: string;
  designation_snapshot: string;
  // Certificate Automation snapshot fields -- captured alongside the
  // Task 9 fields above, at the same moment (employee selection), so
  // the automatically generated type/title/description stay correct
  // forever even if the employee's live record changes later.
  employment_type_snapshot: string;
  joining_date_snapshot: string;
  employment_status_snapshot: string;
  product_name_snapshot: string;
  category_snapshot: string;
  sku_snapshot: string;
};

function emptyForm(category: "Employee" | "Product"): CertificateForm {
  return {
    // Employee certificates are never created from this page (the
    // Add Employee Certificate workflow was removed -- see openAdd),
    // so this branch is unreachable in practice; kept only so
    // emptyForm() stays total over its "Employee" | "Product" param.
    certificate_type: category === "Employee" ? "" : PRODUCT_CERT_TYPES[0],
    customer_id: "",
    customer_name: "",
    employee_name: "",
    product_id: "",
    product_name: "",
    serial_number: "",
    title: "",
    description: "",
    issue_date: new Date().toISOString().slice(0, 10),
    expiry_date: "",
    status: "Active",
    printed_at: "",
    employee_id: "",
    employee_number_snapshot: "",
    employee_name_snapshot: "",
    department_snapshot: "",
    designation_snapshot: "",
    employment_type_snapshot: "",
    joining_date_snapshot: "",
    employment_status_snapshot: "",
    product_name_snapshot: "",
    category_snapshot: "",
    sku_snapshot: ""
  };
}

export default function CertificatesPage(): JSX.Element {

  const { hasPermission } = useAuth();
  const { t } = useLanguage();  const [searchParams, setSearchParams] = useSearchParams();

  const [activeCategory, setActiveCategory] = useState<"Employee" | "Product">("Employee");

  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showModal, setShowModal] = useState(false);

  useEscapeKey(showModal, () => setShowModal(false));
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<CertificateForm>(emptyForm("Employee"));

  // Task 9: searchable Product dropdown state. `productSearchTerm` is
  // only the in-progress query text while the list is open; the field
  // otherwise displays the already-selected product's name (form.product_name).
  const [showProductOptions, setShowProductOptions] = useState(false);
  const [productSearchTerm, setProductSearchTerm] = useState("");

  const filteredProducts = useMemo(() => {

    const query = productSearchTerm.trim().toLowerCase();

    if (!query) return products;

    return products.filter(product =>
      product.name.toLowerCase().includes(query) ||
      (product.sku || "").toLowerCase().includes(query) ||
      (product.category || "").toLowerCase().includes(query) ||
      product.product_id.toLowerCase().includes(query)
    );

  }, [products, productSearchTerm]);

  const [viewCertificate, setViewCertificate] = useState<Certificate | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  async function loadCertificates() {

    setIsLoading(true);

    try {

      const data = await window.mooral.certificates.getAll();
      setCertificates(data);

    }
    catch (error) {

      console.error("Failed to load certificates:", error);

    }
    finally {

      setIsLoading(false);

    }

  }

  async function loadCustomersAndProducts() {

    try {

      // Reuses the existing customers/products IPC handlers -- no new
      // IPC channel added for Task 9, per "reuse existing employee
      // repository / product repository / existing IPC handlers"
      // scope. Employees are intentionally not loaded here: Employee
      // Certificates have no selection/sync workflow on this page.
      const [customerData, productData] = await Promise.all([
        window.mooral.customers.getAll(),
        window.mooral.products.getAll()
      ]);

      setCustomers(customerData);
      setProducts(productData);

    }
    catch (error) {

      console.error("Failed to load customers/products for certificates:", error);

    }

  }

  useEffect(() => {

    loadCertificates();
    loadCustomersAndProducts();

    getCompanySettings()
      .then(setCompanySettings)
      .catch(error => console.error("Failed to load company settings for certificates:", error));

  }, []);

  // Deep-link support: navigating to /certificates?id=123 (from global
  // search) opens that certificate's detail view directly, matching the
  // ?id= convention already used by Customers/Products/Orders.
  useEffect(() => {

    const idParam = searchParams.get("id");

    if (!idParam) return;

    const id = Number(idParam);

    const existing = certificates.find(c => c.id === id);

    if (existing) {

      setActiveCategory(existing.certificate_category);
      setViewCertificate(existing);

    }
    else if (certificates.length > 0) {

      // Not in the currently loaded list (e.g. deep link before load
      // finished) -- fetch it directly.
      window.mooral.certificates.getById(id).then(cert => {

        if (cert) {
          setActiveCategory(cert.certificate_category);
          setViewCertificate(cert);
        }

      }).catch(error => {

        console.error("Failed to load linked certificate:", error);

      });

    }

  }, [searchParams, certificates]);

  const filteredCertificates = useMemo(() => {

    const keyword = search.trim().toLowerCase();

    return certificates.filter(cert => {

      if (cert.certificate_category !== activeCategory) return false;

      if (statusFilter !== "All" && cert.status !== statusFilter) return false;

      if (!keyword) return true;

      return (
        (cert.certificate_id || "").toLowerCase().includes(keyword) ||
        (cert.title || "").toLowerCase().includes(keyword) ||
        (cert.employee_name || "").toLowerCase().includes(keyword) ||
        (cert.customer_name || "").toLowerCase().includes(keyword) ||
        (cert.product_name || "").toLowerCase().includes(keyword) ||
        (cert.serial_number || "").toLowerCase().includes(keyword)
      );

    });

  }, [certificates, activeCategory, statusFilter, search]);

  useEffect(() => {

    setCurrentPage(1);

  }, [activeCategory, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredCertificates.length / PAGE_SIZE));

  const paginatedCertificates = useMemo(() => {

    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredCertificates.slice(start, start + PAGE_SIZE);

  }, [filteredCertificates, currentPage]);

  function openAdd() {

    setEditId(null);

    const base = emptyForm(activeCategory);

    // Apply Settings > Certificate > Enable Expiry / Default Validity to
    // new certificates, so those settings actually do something (rather
    // than being configurable but silently ignored).
    if (companySettings?.certificateEnableExpiry && companySettings.certificateDefaultValidityDays > 0) {

      const issueDate = new Date(base.issue_date);
      issueDate.setDate(issueDate.getDate() + companySettings.certificateDefaultValidityDays);
      base.expiry_date = issueDate.toISOString().slice(0, 10);

    }

    setForm(base);
    setShowProductOptions(false);
    setProductSearchTerm("");
    setShowModal(true);

  }

  function openEdit(cert: Certificate) {

    setEditId(cert.id ?? null);
    setShowProductOptions(false);
    setProductSearchTerm("");

    setForm({
      certificate_type: cert.certificate_type || (activeCategory === "Product" ? PRODUCT_CERT_TYPES[0] : ""),
      customer_id: cert.customer_id || "",
      customer_name: cert.customer_name || "",
      employee_name: cert.employee_name || "",
      product_id: cert.product_id || "",
      product_name: cert.product_name || "",
      serial_number: cert.serial_number || "",
      title: cert.title || "",
      description: cert.description || "",
      issue_date: cert.issue_date ? cert.issue_date.slice(0, 10) : new Date().toISOString().slice(0, 10),
      expiry_date: cert.expiry_date ? cert.expiry_date.slice(0, 10) : "",
      status: cert.status || "Active",
      printed_at: cert.printed_at || "",
      // Older certificates saved before Task 9 won't have these yet --
      // default to "" (still read-only/non-editable in the form; the
      // user must re-select from the dropdown to populate them).
      employee_id: cert.employee_id || "",
      employee_number_snapshot: cert.employee_number_snapshot || "",
      employee_name_snapshot: cert.employee_name_snapshot || cert.employee_name || "",
      department_snapshot: cert.department_snapshot || "",
      designation_snapshot: cert.designation_snapshot || "",
      // Certificate Automation snapshot fields -- loaded exactly as
      // stored. Never recomputed here: a historical certificate's
      // automatically generated wording must stay frozen even if the
      // employee's live employment_type/joining_date/employment_status
      // have since changed.
      employment_type_snapshot: cert.employment_type_snapshot || "",
      joining_date_snapshot: cert.joining_date_snapshot ? cert.joining_date_snapshot.slice(0, 10) : "",
      employment_status_snapshot: cert.employment_status_snapshot || "",
      product_name_snapshot: cert.product_name_snapshot || cert.product_name || "",
      category_snapshot: cert.category_snapshot || "",
      sku_snapshot: cert.sku_snapshot || ""
    });

    setShowModal(true);

  }

  function handleCustomerChange(customerId: string) {

    const match = customers.find(c => c.customer_id === customerId);

    setForm(prev => ({
      ...prev,
      customer_id: customerId,
      customer_name: match?.name || ""
    }));

  }

  /**
   * Task 9: selecting a Product copies Name / Category / SKU into
   * read-only snapshot fields (product master data, frozen at save
   * time -- see the *_snapshot columns), and re-derives Title +
   * Description from the current Certificate Type / Issue Date /
   * Expiry Date already in the form, via the centralized
   * computeProductCertificateTitle/Description() functions above.
   */
  function handleProductChange(productId: string) {

    const match = products.find(p => p.product_id === productId);
    const productName = match?.name || "";

    setForm(prev => ({
      ...prev,
      product_id: productId,
      product_name: productName,
      product_name_snapshot: productName,
      category_snapshot: match?.category || "",
      sku_snapshot: match?.sku || "",
      title: productName ? computeProductCertificateTitle(prev.certificate_type) : "",
      description: productName
        ? computeProductCertificateDescription(prev.certificate_type, productName, prev.issue_date, prev.expiry_date || null)
        : ""
    }));

  }

  /**
   * Task 9: Certificate Type for Product certificates stays a manual
   * dropdown selection (unlike Employee, where it's fully derived),
   * but Title/Description regenerate from it immediately, the same
   * way they do when the Product selection changes.
   */
  function handleProductCertificateTypeChange(certificateType: string) {

    setForm(prev => ({
      ...prev,
      certificate_type: certificateType,
      title: prev.product_name ? computeProductCertificateTitle(certificateType) : prev.title,
      description: prev.product_name
        ? computeProductCertificateDescription(certificateType, prev.product_name, prev.issue_date, prev.expiry_date || null)
        : prev.description
    }));

  }

  /**
   * Task 9 + Expiry Date Rule: Issue Date / Expiry Date for a Product
   * certificate always come from these form fields (never from the
   * Product database), and any edit to either re-derives Description
   * so the generated wording ("...until {Expiry Date}.") always
   * reflects what's currently typed in the form.
   */
  function handleProductDateChange(field: "issue_date" | "expiry_date", value: string) {

    setForm(prev => {

      const next = { ...prev, [field]: value };

      if (!prev.product_name) return next;

      return {
        ...next,
        description: computeProductCertificateDescription(
          next.certificate_type,
          prev.product_name,
          next.issue_date,
          next.expiry_date || null
        )
      };

    });

  }

  async function saveCertificate() {

    if (!form.title.trim()) {
      window.alert(t("certificates.titleRequired"));
      return;
    }

    if (activeCategory === "Product" && !form.customer_id) {
      window.alert(t("certificates.selectCustomerRequired"));
      return;
    }

    if (activeCategory === "Product" && !form.product_id) {
      window.alert(t("certificates.selectProductRequired"));
      return;
    }

    // Prevent a fast double-click (or a slow IPC round trip) from
    // submitting the same certificate twice.
    if (isSubmitting) {
      return;
    }

    const payload = {

      certificate_category: activeCategory,
      certificate_type: form.certificate_type,
      customer_id: activeCategory === "Product" ? form.customer_id : "",
      customer_name: activeCategory === "Product" ? form.customer_name : "",
      employee_name: activeCategory === "Employee" ? form.employee_name : "",
      product_id: activeCategory === "Product" ? form.product_id : "",
      product_name: activeCategory === "Product" ? form.product_name : "",
      serial_number: activeCategory === "Product" ? form.serial_number : "",
      title: form.title,
      description: form.description,
      issue_date: form.issue_date ? new Date(form.issue_date).toISOString() : undefined,
      expiry_date: form.expiry_date ? new Date(form.expiry_date).toISOString() : null,
      status: form.status,

      // Task 9 snapshot fields. Product snapshot fields are sourced from
      // the selected Product record via handleProductChange. Employee
      // snapshot fields are never set from this page -- they're simply
      // carried over unchanged from the certificate the Employee module
      // already created (see openEdit above).
      employee_id: activeCategory === "Employee" ? form.employee_id : "",
      employee_number_snapshot: activeCategory === "Employee" ? form.employee_number_snapshot : "",
      employee_name_snapshot: activeCategory === "Employee" ? form.employee_name_snapshot : "",
      department_snapshot: activeCategory === "Employee" ? form.department_snapshot : "",
      designation_snapshot: activeCategory === "Employee" ? form.designation_snapshot : "",
      // Certificate Automation snapshot fields (Employee only).
      employment_type_snapshot: activeCategory === "Employee" ? form.employment_type_snapshot : "",
      joining_date_snapshot: activeCategory === "Employee" && form.joining_date_snapshot
        ? new Date(form.joining_date_snapshot).toISOString()
        : null,
      employment_status_snapshot: activeCategory === "Employee" ? form.employment_status_snapshot : "",
      product_name_snapshot: activeCategory === "Product" ? form.product_name_snapshot : "",
      category_snapshot: activeCategory === "Product" ? form.category_snapshot : "",
      sku_snapshot: activeCategory === "Product" ? form.sku_snapshot : ""

    };

    setIsSubmitting(true);

    try {

      if (editId) {

        await window.mooral.certificates.update({
          id: editId,
          certificate: payload
        });

      }
      else {

        await window.mooral.certificates.create(payload);

      }

      setShowModal(false);
      await loadCertificates();

    }
    catch (error) {

      console.error("Failed to save certificate:", error);

      window.alert(
        error instanceof Error
          ? error.message
          : t("certificates.saveFailed")
      );

      return;

    }
    finally {

      setIsSubmitting(false);

    }

  }

  async function removeCertificate(id: number) {

    if (!window.confirm(t("certificates.confirmDelete"))) return;

    try {

      await window.mooral.certificates.delete(id);
      await loadCertificates();

      if (viewCertificate?.id === id) {
        setViewCertificate(null);
      }

    }
    catch (error) {

      console.error("Failed to delete certificate:", error);

      window.alert(
        error instanceof Error
          ? error.message
          : t("certificates.deleteFailed")
      );

    }

  }

  function openView(cert: Certificate) {

    setViewCertificate(cert);
    setSearchParams({ id: String(cert.id) });

  }

  function closeView() {

    setViewCertificate(null);
    searchParams.delete("id");
    setSearchParams(searchParams);

  }

  // ==========================================================
  // PDF GENERATION
  // ==========================================================

  function buildQrPayload(cert: Certificate): string {

    return (
      `Certificate: ${cert.certificate_id} | ` +
      `Issued: ${formatDateShort(cert.issue_date)} | ` +
      `${cert.certificate_category === "Employee" ? "Employee" : "Customer"}: ${cert.certificate_category === "Employee" ? cert.employee_name : cert.customer_name} | ` +
      `Status: ${cert.status}`
    );

  }

  async function buildQrDataUrl(cert: Certificate): Promise<string> {

    return QRCode.toDataURL(buildQrPayload(cert), { margin: 1, width: 160 });

  }

  // Employee Certificate only: same verification payload/logic as
  // buildQrDataUrl above, but rendered as raw, lossless SVG markup
  // (instead of a rasterized PNG data URL) so the QR stays perfectly
  // sharp at any size in the exported PDF and remains fully
  // scannable. Product Certificate keeps using buildQrDataUrl via
  // loadCertificatePdfContext below, unchanged.
  async function buildEmployeeQrSvg(cert: Certificate): Promise<string> {

    return QRCode.toString(buildQrPayload(cert), {
      type: "svg",
      margin: 1,
      color: { dark: "#172B4D", light: "#00000000" }
    });

  }

  async function loadCertificatePdfContext(cert: Certificate) {

    const company = await getCompanySettings();

    const logoData = (company.hasLogo && company.certificateReuseCompanyLogo)
      ? await window.mooral.settings.getLogoPreview()
      : null;

    const qrDataUrl = company.certificateQrVerification
      ? await buildQrDataUrl(cert)
      : null;

    return { company, logoData, qrDataUrl };

  }

  /**
   * Employee Certificate: a modern multinational-corporate HR
   * document (letterhead header, thin rule, reference/date line,
   * centered certificate heading, justified letter body, an Employee
   * Details summary, verification QR and signature block, minimalist
   * contact footer). Every visible value below comes from the
   * certificate record / Company Settings -- nothing from any
   * reference document is hardcoded here. Used for both the print
   * preview (printCertificate) and the exported PDF
   * (exportCertificatePdf) below, so both always render identically.
   */
  // Gathers the certificate data (loadCertificatePdfContext call,
  // detail-item resolution) and hands it to
  // renderEmployeeCertificateHtml() to build the markup.
  // Employee Certificate only: existing joining_date_snapshot -> issue_date
  // span, formatted "X Years Y Months" for the Service Duration info
  // column. Both dates already exist on the certificate record; nothing
  // new is added or fabricated. Returns "-" when either date is missing,
  // exactly like the other snapshot fields.
  function formatServiceDuration(cert: Certificate): string {

    if (!cert.joining_date_snapshot || !cert.issue_date) return "-";

    const start = new Date(cert.joining_date_snapshot);
    const end = new Date(cert.issue_date);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return "-";

    let years = end.getFullYear() - start.getFullYear();
    let months = end.getMonth() - start.getMonth();

    if (end.getDate() < start.getDate()) months -= 1;
    if (months < 0) { years -= 1; months += 12; }

    const parts = [];
    if (years > 0) parts.push(`${years} Year${years === 1 ? "" : "s"}`);
    if (months > 0 || years === 0) parts.push(`${months} Month${months === 1 ? "" : "s"}`);

    return parts.join(" ");

  }

  async function buildEmployeeCertificateHtmlNew(cert: Certificate): Promise<string> {

    const { company, logoData: rawLogoData } = await loadCertificatePdfContext(cert);

    // Logo integration (branding task): loadCertificatePdfContext()
    // above already returns null when certificateReuseCompanyLogo is
    // off (an explicit tenant opt-out we must not override) or when
    // no company logo has been uploaded. Only in the latter case -
    // reuse is allowed but nothing is configured yet - do we fall
    // back to the official Mooral Business Suite logo.
    const logoData = company.certificateReuseCompanyLogo
      ? (rawLogoData ?? MOORAL_LOGO_DATA_URL)
      : rawLogoData;

    const contactLine = [company.address, company.phone, company.email, company.website]
      .filter(Boolean)
      .join("   \u2022   ");

    const qrSvgMarkup = company.certificateQrVerification
      ? await buildEmployeeQrSvg(cert)
      : null;

    const infoColumns = [
      { label: "Service Duration", value: formatServiceDuration(cert) },
      { label: "Employee No.", value: cert.employee_number_snapshot || "-" },
      { label: "Certificate No.", value: cert.certificate_id },
      { label: "Issue Date", value: formatDateShort(cert.issue_date) }
    ];

    return renderEmployeeCertificateHtml({
      certificateId: cert.certificate_id,
      certificateTitle: cert.certificate_type || cert.title || "Certificate",
      employeeName: cert.employee_name_snapshot || cert.employee_name || "",
      designation: cert.designation_snapshot || null,
      issueDateFormatted: formatDateShort(cert.issue_date),
      validUntilFormatted: cert.expiry_date ? formatDateShort(cert.expiry_date) : null,
      infoColumns,
      descriptionText: cert.description || "",
      companyName: company.companyName,
      companyAddress: company.address,
      companyPhone: company.phone,
      companyEmail: company.email,
      logoDataUrl: logoData,
      qrSvgMarkup,
      footerText: company.certificateFooterText || contactLine || company.companyName
    });

  }


  async function buildEmployeeCertificateHtml(cert: Certificate): Promise<string> {
    return buildEmployeeCertificateHtmlNew(cert);
  }

  /**
   * Product Certificate.
   */
  // Gathers the certificate data
  // below (same loadCertificatePdfContext call, same detail-row
  // resolution) but hands it to renderProductCertificateHtml()
  // instead of building an HTML string by hand. No business logic
  // differs from the legacy path - only how the final markup is
  // assembled.
  async function buildProductCertificateHtmlNew(cert: Certificate): Promise<string> {

    const { company, logoData: rawLogoData, qrDataUrl } = await loadCertificatePdfContext(cert);

    // Logo integration (branding task): same fallback rule as the
    // Employee Certificate above - only fills in the official
    // Mooral Business Suite logo when reuse is allowed but nothing
    // has been uploaded yet; an explicit certificateReuseCompanyLogo
    // opt-out is still respected exactly as before.
    const logoData = company.certificateReuseCompanyLogo
      ? (rawLogoData ?? MOORAL_LOGO_DATA_URL)
      : rawLogoData;

    const detailRows = [
      { label: "Certificate No", value: cert.certificate_id },
      { label: "Certificate Type", value: cert.certificate_type },
      { label: "Customer", value: cert.customer_name || "-" },
      { label: "Product", value: cert.product_name_snapshot || cert.product_name || "-" },
      cert.category_snapshot ? { label: "Category", value: cert.category_snapshot } : null,
      cert.sku_snapshot ? { label: "SKU", value: cert.sku_snapshot } : null,
      cert.serial_number ? { label: "Serial Number", value: cert.serial_number } : null,
      { label: "Issue Date", value: formatDateShort(cert.issue_date) },
      cert.expiry_date ? { label: "Expiry Date", value: formatDateShort(cert.expiry_date) } : null,
      { label: "Status", value: cert.status }
    ].filter((row): row is { label:string; value:string } => row !== null);

    return renderProductCertificateHtml({
      certificateId: cert.certificate_id,
      certificateTypeLabel: cert.certificate_type || "Product Certificate",
      productName: cert.product_name_snapshot || cert.product_name,
      customerName: cert.customer_name,
      category: cert.category_snapshot,
      sku: cert.sku_snapshot,
      serialNumber: cert.serial_number,
      statusLabel: cert.status,
      issueDateFormatted: formatDateShort(cert.issue_date),
      expiryDateFormatted: cert.expiry_date ? formatDateShort(cert.expiry_date) : null,
      companyName: company.companyName,
      companyAddress: company.address,
      companyPhone: company.phone,
      companyEmail: company.email,
      logoDataUrl: logoData,
      detailRows,
      statementText:
        `This certifies that the product detailed below has been issued to the customer named, ` +
        `subject to the terms of ${cert.certificate_type || "this certificate"}.`,
      descriptionText: cert.description,
      qrDataUrl,
      authorizedName: company.certificateAuthorizedSignature || "Authorized Signature",
      authorizedDesignation: company.certificateAuthorizedDesignation || "",
      footerText:
        company.certificateFooterText ||
        `${company.companyName} \u2022 ${company.phone || ""} \u2022 ${company.email || ""}`
    });

  }


  async function buildProductCertificateHtml(cert: Certificate): Promise<string> {
    return buildProductCertificateHtmlNew(cert);
  }

  async function buildCertificateHtml(cert: Certificate): Promise<string> {

    return cert.certificate_category === "Employee"
      ? buildEmployeeCertificateHtml(cert)
      : buildProductCertificateHtml(cert);

  }

  // Employee Certificate status automation: Pending -> Printed.
  // Certificates are never created from this page (see emptyForm above),
  // so there is no "new certificate" branch here -- any Employee
  // certificate whose status isn't yet "Printed" is simply displayed as
  // Pending. certificates.markPrinted() sets printed_at server-side via
  // COALESCE, so it is safe to call on every print/export -- the
  // original timestamp can never be overwritten, even by this client
  // check racing another window.
  async function markEmployeeCertificatePrinted(cert: Certificate) {

    if (cert.certificate_category !== "Employee") return;
    if (cert.status === "Printed") return;
    if (!cert.id) return;

    try {

      await window.mooral.certificates.markPrinted(cert.id);

      const printedAt = new Date().toISOString();

      setCertificates(prev => prev.map(c =>
        c.id === cert.id ? { ...c, status: "Printed", printed_at: printedAt } : c
      ));

      setViewCertificate(prev =>
        prev && prev.id === cert.id ? { ...prev, status: "Printed", printed_at: printedAt } : prev
      );

    }
    catch (error) {

      // Non-fatal: the certificate was still printed/exported, so this
      // is logged rather than surfaced as a blocking alert.
      console.error("Failed to update certificate status to Printed:", error);

    }

  }

  async function printCertificate(cert: Certificate) {

    try {

      const html = await buildCertificateHtml(cert);

      const result = await showPrintPreview({
        html,
        documentLabel: buildPrintDocumentLabel("Certificate", cert.certificate_id)
      });

      // "printed" means the native print operation completed successfully.
      if (result === "printed") {
        await markEmployeeCertificatePrinted(cert);
      }

    }
    catch (error) {

      console.error("Failed to print certificate:", error);
      window.alert(t("forgotPassword.printPreviewFailed"));

    }

  }

  async function exportCertificatePdf(cert: Certificate) {

    try {

      const html = await buildCertificateHtml(cert);

      const result = await window.mooral.certificates.exportPdf({
        html,
        fileName: `${cert.certificate_id}.pdf`
      });

      if (!result?.success && !result?.cancelled) {

        window.alert(
          result?.error
            ? `${t("certificates.exportFailedPrefix")}${result.error}`
            : t("certificates.exportFailed")
        );

        return;

      }

      if (result?.success) {
        await markEmployeeCertificatePrinted(cert);
      }

    }
    catch (error) {

      console.error("Failed to export certificate PDF:", error);
      window.alert(t("certificates.exportFailed"));

    }

  }

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="certificates-page">

      <div className="certificates-header">
        <div>
          <h1>{t("certificates.title")}</h1>
          <p>{t("certificates.subtitle")}</p>
        </div>

        {activeCategory === "Product" && hasPermission("certificates.create") && (
          <button className="add-certificate-btn" onClick={openAdd}>
            <Plus size={18} />
            {t("certificates.newProductCertificate")}
          </button>
        )}
      </div>

      <div className="certificate-tabs">

        <button
          className={activeCategory === "Employee" ? "tab active" : "tab"}
          onClick={() => setActiveCategory("Employee")}
        >
          {t("certificates.employeeCertificatesTab")}
        </button>

        <button
          className={activeCategory === "Product" ? "tab active" : "tab"}
          onClick={() => setActiveCategory("Product")}
        >
          {t("certificates.productCertificatesTab")}
        </button>

      </div>

      <div className="certificates-toolbar">

        <div className="search-box">
          <Search size={18} />
          <input
            placeholder="Search by certificate number, name, title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">{t("certificates.allStatus")}</option>
          {STATUS_OPTIONS.map(status => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>

      </div>

      <div className="certificates-table">

        <div className="certificate-row certificate-row-header">
          <span>{t("certificates.certificateNo")}</span>
          <span>{activeCategory === "Employee" ? "Employee" : "Customer / Product"}</span>
          <span>{t("certificates.type")}</span>
          <span>{t("certificates.issueDate")}</span>
          <span>{t("certificates.status")}</span>
          <span>{t("certificates.actions")}</span>
        </div>

        {isLoading && (
          <div className="certificate-empty">Loading certificates…</div>
        )}

        {!isLoading && filteredCertificates.length === 0 && (
          <div className="certificate-empty">No {activeCategory.toLowerCase()} certificates found.</div>
        )}

        {!isLoading && paginatedCertificates.map(cert => (
          <div className="certificate-row" key={cert.id ?? cert.certificate_id}>
            <span className="certificate-id-cell" onClick={() => openView(cert)}>
              {cert.certificate_id}
            </span>
            <span>
              {cert.certificate_category === "Employee"
                ? cert.employee_name
                : `${cert.customer_name} / ${cert.product_name}`}
            </span>
            <span>{cert.certificate_type}</span>
            <span>{formatDateShort(cert.issue_date)}</span>
            {cert.certificate_category === "Employee" ? (
              <span className="certificate-status employee-status-badge">
                <span style={{ fontWeight: 600 }}>
                  {cert.status === "Printed" ? "\uD83D\uDFE2 Printed" : "\uD83D\uDFE1 Pending"}
                </span>
                {cert.status === "Printed" && cert.printed_at && (
                  <span style={{ display: "block", fontSize: "10px", color: "#6b7280" }}>
                    {formatDateShort(cert.printed_at)} {formatPrintTime(cert.printed_at)}
                  </span>
                )}
              </span>
            ) : (
              <span className={`certificate-status status-${(cert.status || "").toLowerCase()}`}>
                {cert.status}
              </span>
            )}
            <span className="certificate-actions">
              <button className="icon-action-btn" title="View" onClick={() => openView(cert)}>
                <Eye size={16} />
              </button>
              {hasPermission("certificates.edit") && (
              <button className="icon-action-btn" title="Edit" onClick={() => openEdit(cert)}>
                <Pencil size={16} />
              </button>
              )}
              {hasPermission("certificates.delete") && (
              <button className="icon-action-btn danger" title="Delete" onClick={() => cert.id && removeCertificate(cert.id)}>
                <Trash2 size={16} />
              </button>
              )}
            </span>
          </div>
        ))}

      </div>

      {!isLoading && filteredCertificates.length > 0 && (
        <div className="certificate-pagination">

          <span className="certificate-pagination-info">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}
            –{Math.min(currentPage * PAGE_SIZE, filteredCertificates.length)} of {filteredCertificates.length}
          </span>

          <div className="certificate-pagination-controls">

            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            >
              {t("common.previous")}
            </button>

            <span className="certificate-pagination-page">
              Page {currentPage} of {totalPages}
            </span>

            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            >
              {t("common.next")}
            </button>

          </div>

        </div>
      )}

      {showModal && (
        <div className="certificate-modal-overlay">
          <div className="certificate-modal" onClick={(e) => e.stopPropagation()}>

            <h2>{editId ? "Edit" : "New"} {activeCategory} Certificate</h2>

            <div className="form-group">
              <label>{t("certificates.certificateType")}</label>
              {activeCategory === "Employee" ? (
                // Certificate Automation: derived from the selected
                // employee's Employment Type + Employment Status --
                // not manually editable for Employee certificates.
                <input
                  value={form.certificate_type}
                  readOnly
                  placeholder="Select an employee to generate"
                />
              ) : (
                <select
                  value={form.certificate_type}
                  onChange={(e) => handleProductCertificateTypeChange(e.target.value)}
                >
                  {PRODUCT_CERT_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              )}
            </div>

            {activeCategory === "Employee" ? (
              <>
                <div className="form-grid">

                  <div className="form-group">
                    <label>{t("certificates.employeeNumber")}</label>
                    <input value={form.employee_number_snapshot} readOnly placeholder="Managed by the Employee module" />
                  </div>

                  <div className="form-group">
                    <label>{t("certificates.employeeName")}</label>
                    <input value={form.employee_name_snapshot} readOnly placeholder="Managed by the Employee module" />
                  </div>

                </div>

                <div className="form-grid">

                  <div className="form-group">
                    <label>{t("certificates.department")}</label>
                    <input value={form.department_snapshot} readOnly placeholder="Managed by the Employee module" />
                  </div>

                  <div className="form-group">
                    <label>{t("certificates.designation")}</label>
                    <input value={form.designation_snapshot} readOnly placeholder="Managed by the Employee module" />
                  </div>

                </div>

                <div className="form-grid">

                  <div className="form-group">
                    <label>{t("certificates.employmentType")}</label>
                    <input value={form.employment_type_snapshot} readOnly placeholder="Managed by the Employee module" />
                  </div>

                  <div className="form-group">
                    <label>{t("certificates.employmentStatus")}</label>
                    <input value={form.employment_status_snapshot} readOnly placeholder="Managed by the Employee module" />
                  </div>

                </div>

                <div className="form-group">
                  <label>{t("certificates.joiningDate")}</label>
                  <input
                    value={formatDateShort(form.joining_date_snapshot)}
                    readOnly
                    placeholder="Managed by the Employee module"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="form-group">
                  <label>{t("certificates.customer")}</label>
                  <select
                    value={form.customer_id}
                    onChange={(e) => handleCustomerChange(e.target.value)}
                  >
                    <option value="">{t("certificates.selectCustomer")}</option>
                    {customers.map(customer => (
                      <option key={customer.id ?? customer.customer_id} value={customer.customer_id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group product-combobox">
                  <label>{t("certificates.product")}</label>
                  <div className="product-combobox-input-wrap">
                    <input
                      type="text"
                      autoComplete="off"
                      value={showProductOptions ? productSearchTerm : form.product_name}
                      placeholder="Search product by name, SKU or category"
                      onFocus={() => {
                        setShowProductOptions(true);
                        setProductSearchTerm("");
                      }}
                      onChange={(e) => setProductSearchTerm(e.target.value)}
                      onBlur={() => {
                        // Delay so a click on an option (onMouseDown below)
                        // fires before the list unmounts.
                        window.setTimeout(() => setShowProductOptions(false), 150);
                      }}
                    />
                    {showProductOptions && (
                      <div className="product-combobox-list">
                        {filteredProducts.length === 0 ? (
                          <div className="product-combobox-empty">{t("certificates.noMatchingProducts")}</div>
                        ) : (
                          filteredProducts.map(product => (
                            <div
                              key={product.id ?? product.product_id}
                              className="product-combobox-option"
                              onMouseDown={() => {
                                handleProductChange(product.product_id);
                                setProductSearchTerm("");
                                setShowProductOptions(false);
                              }}
                            >
                              <span className="product-combobox-option-name">{product.name}</span>
                              <span className="product-combobox-option-meta">
                                {[product.category, product.sku].filter(Boolean).join(" • ") || product.product_id}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  {!form.product_id && (
                    <p className="product-combobox-hint">
                      Search and select a product to auto-fill Category, SKU, Title and Description.
                    </p>
                  )}
                </div>

                <div className="form-grid">

                  <div className="form-group">
                    <label>{t("certificates.category")}</label>
                    <input value={form.category_snapshot} readOnly placeholder="Auto-filled on selection" />
                  </div>

                  <div className="form-group">
                    <label>SKU (Model)</label>
                    <input value={form.sku_snapshot} readOnly placeholder="Auto-filled on selection" />
                  </div>

                </div>

                <div className="form-group">
                  <label>{t("certificates.serialNumber")}</label>
                  <input
                    value={form.serial_number}
                    onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="form-group">
              <label>{t("certificates.certificateTitle")}</label>
              {activeCategory === "Employee" ? (
                // Employee Certificate editing rules: Resigned / End of
                // Contract certificates have their Title generated by
                // the Employee module and stay read-only here.
                // Terminated certificates are written manually by the
                // user on this page.
                form.employment_status_snapshot === "Terminated" ? (
                  <input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Enter certificate title"
                  />
                ) : (
                  <input
                    value={form.title}
                    readOnly
                    placeholder="Generated by the Employee module"
                  />
                )
              ) : (
                // Task 9: derived from Certificate Type (see
                // computeProductCertificateTitle) once a product is
                // selected -- not manually editable, same as Employee.
                <input
                  value={form.title}
                  readOnly
                  placeholder="Select a product to generate"
                />
              )}
            </div>

            <div className="form-group">
              <label>{t("certificates.description")}</label>
              {activeCategory === "Employee" && form.employment_status_snapshot !== "Terminated" ? (
                // Resigned / End of Contract: generated by the Employee
                // module and read-only here, same as Title above.
                <textarea
                  rows={3}
                  value={form.description}
                  readOnly
                />
              ) : (
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={activeCategory === "Employee" ? "Enter certificate description" : undefined}
                />
              )}
            </div>

            <div className="form-grid">

              <div className="form-group">
                <label>{t("certificates.issueDate")}</label>
                <input
                  type="date"
                  value={form.issue_date}
                  onChange={(e) =>
                    activeCategory === "Product"
                      ? handleProductDateChange("issue_date", e.target.value)
                      : setForm({ ...form, issue_date: e.target.value })
                  }
                />
              </div>

              <div className="form-group">
                <label>{t("certificates.expiryDate")}</label>
                <input
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) =>
                    activeCategory === "Product"
                      ? handleProductDateChange("expiry_date", e.target.value)
                      : setForm({ ...form, expiry_date: e.target.value })
                  }
                />
              </div>

            </div>

            <div className="form-group">
              <label>{t("certificates.status")}</label>
              {activeCategory === "Employee" ? (
                <div>
                  <span style={{ fontWeight: 600 }}>
                    {form.status === "Printed" ? "\uD83D\uDFE2 Printed" : "\uD83D\uDFE1 Pending"}
                  </span>
                  {form.status === "Printed" && form.printed_at && (
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                      {t("certificates.printedOn")}<br />
                      {formatDateShort(form.printed_at)}<br />
                      {formatPrintTime(form.printed_at)}
                    </div>
                  )}
                  {form.status !== "Printed" && (
                    <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                      Automatically becomes Printed on first print or PDF export.
                    </div>
                  )}
                </div>
              ) : (
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {STATUS_OPTIONS.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="certificate-modal-actions">
              <button className="cancel-btn" onClick={() => setShowModal(false)} disabled={isSubmitting}>
                <X size={16} />
                {t("common.cancel")}
              </button>
              <button className="save-btn" onClick={saveCertificate} disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save Certificate"}
              </button>
            </div>

          </div>
        </div>
      )}

      {viewCertificate && (
        <div className="certificate-modal-overlay">
          <div className="certificate-modal" onClick={(e) => e.stopPropagation()}>

            <h2>{viewCertificate.certificate_id}</h2>

            <div className="certificate-view-grid">
              <div><span>{t("certificates.type")}</span><strong>{viewCertificate.certificate_type}</strong></div>
              {viewCertificate.certificate_category === "Employee" ? (
                <div><span>{t("certificates.employee")}</span><strong>{viewCertificate.employee_name}</strong></div>
              ) : (
                <>
                  <div><span>{t("certificates.customer")}</span><strong>{viewCertificate.customer_name}</strong></div>
                  <div><span>{t("certificates.product")}</span><strong>{viewCertificate.product_name}</strong></div>
                  {viewCertificate.serial_number && (
                    <div><span>{t("certificates.serialNumber")}</span><strong>{viewCertificate.serial_number}</strong></div>
                  )}
                </>
              )}
              <div><span>{t("certificates.certificateTitle")}</span><strong>{viewCertificate.title}</strong></div>
              <div><span>{t("certificates.issueDate")}</span><strong>{formatDateShort(viewCertificate.issue_date)}</strong></div>
              {viewCertificate.expiry_date && (
                <div><span>{t("certificates.expiryDate")}</span><strong>{formatDateShort(viewCertificate.expiry_date)}</strong></div>
              )}
              <div>
                <span>{t("certificates.status")}</span>
                {viewCertificate.certificate_category === "Employee" ? (
                  <strong>
                    {viewCertificate.status === "Printed" ? "\uD83D\uDFE2 Printed" : "\uD83D\uDFE1 Pending"}
                    {viewCertificate.status === "Printed" && viewCertificate.printed_at && (
                      <span style={{ display: "block", fontWeight: 400, fontSize: "11px", color: "#6b7280" }}>
                        {t("certificates.printedOn")} {formatDateShort(viewCertificate.printed_at)} {formatPrintTime(viewCertificate.printed_at)}
                      </span>
                    )}
                  </strong>
                ) : (
                  <strong>{viewCertificate.status}</strong>
                )}
              </div>
            </div>

            {viewCertificate.description && (
              <p className="certificate-view-description">{viewCertificate.description}</p>
            )}

            <div className="certificate-modal-actions">
              <button className="cancel-btn" onClick={closeView}>
                <X size={16} />
                {t("common.close")}
              </button>
              {hasPermission("certificates.print") && (
                <button className="print-btn" onClick={() => printCertificate(viewCertificate)}>
                  <Printer size={16} />
                  {t("common.print")}
                </button>
              )}
              {hasPermission("certificates.pdf_export") && (
                <button className="save-btn" onClick={() => exportCertificatePdf(viewCertificate)}>
                  <FileDown size={16} />
                  {t("common.exportPdf")}
                </button>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );

}