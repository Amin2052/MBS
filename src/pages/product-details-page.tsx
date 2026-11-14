import {
  ArrowLeft,
  Pencil,
  Trash2
} from "lucide-react";

import {
  useEffect,
  useState
} from "react";

import {
  useNavigate,
  useSearchParams
} from "react-router-dom";

import "./product-details.css";

import { useCurrency } from "@/hooks/use-currency";
import { useLanguage } from "@/hooks/use-language";
import { formatNumber } from "@/utils/format-number";
import { formatDateTime } from "@/utils/date-format";

// Product is declared globally in src/types/electron.d.ts
// (previously this file redeclared a local copy of the same type).

export default function ProductDetailsPage(): JSX.Element {

  const navigate = useNavigate();
  const { format: formatCurrency } = useCurrency();
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const productId = searchParams.get("id");
  const [product,setProduct] = useState<Product|null>(null);

  useEffect(()=>{
    async function loadProduct(){
      if(!productId) return;
      const products = await window.mooral.products.getAll();
      const found = products.find((item:Product)=>String(item.id)===productId);
      setProduct(found || null);
    }
    loadProduct();
  },[productId]);

  async function deleteProduct(){
    if(!product) return;
    if(product.id === undefined) return;
    if(!window.confirm(t("productDetails.confirmDelete"))) return;
    await window.mooral.products.delete(product.id);
    navigate("/products");
  }

  if(!product){
    return <div className="product-details-page"><h2>{t("productDetails.productNotFound")}</h2></div>;
  }

  return (
    <div className="product-details-page">

      <div className="details-header">
        <div className="details-title">
          <h1>{t("products.detailsTitle")}</h1>
          <p>{t("productDetails.subtitle")}</p>
        </div>

        <button className="back-button" onClick={()=>navigate("/products")}>
          <ArrowLeft size={18}/>
          {t("productDetails.back")}
        </button>
      </div>

      <div className="product-card">

        <div className="product-summary">
          <div className="product-avatar">
            {product.name.charAt(0).toUpperCase()}
          </div>

          <div>
            <h2>{product.name}</h2>
            <span>{product.product_id}</span>
          </div>
        </div>

        <div className="product-info">

          <div className="info-box">
            <span>{t("products.category")}</span>
            <strong>{product.category}</strong>
          </div>

          <div className="info-box">
            <span>{t("products.sku")}</span>
            <strong>{product.sku}</strong>
          </div>

          <div className="info-box">
            <span>{t("productDetails.sellingPrice")}</span>
            <strong>{formatCurrency(product.price ?? 0)}</strong>
          </div>

          <div className="info-box">
            <span>{t("productDetails.currentStock")}</span>
            <strong
              className={product.stock<10?"stock-danger":"stock-success"}
              title={String(product.stock)}
            >
              {formatNumber(product.stock)}
            </strong>
          </div>

          <div className="info-box">
            <span>{t("productDetails.createdAt")}</span>
            <strong>{formatDateTime(product.created_at)}</strong>
          </div>

          <div className="info-box">
            <span>{t("productDetails.lastUpdated")}</span>
            <strong>{formatDateTime(product.updated_at)}</strong>
          </div>

        </div>

        <div className="details-actions">
          <button className="edit-btn" onClick={()=>navigate("/products?id=" + product.id)}>
            <Pencil size={18}/>
            {t("products.editProduct")}
          </button>

          <button className="delete-btn" onClick={deleteProduct}>
            <Trash2 size={18}/>
            {t("common.delete")}
          </button>
        </div>

      </div>
    </div>
  );
}
