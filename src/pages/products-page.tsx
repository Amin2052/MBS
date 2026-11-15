import {
  Search,
  Plus,
  X,
  Pencil,
  Trash2,
  ArrowLeft
} from "lucide-react";

import { useEscapeKey } from "@/hooks/use-escape-key";


import {
  useEffect,
  useMemo,
  useState
} from "react";


import {
  useSearchParams,
  useNavigate
} from "react-router-dom";


import "./products.css";


import {
  formatNumber
} from "../utils/format-number";

import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/hooks/use-currency";
import { useLanguage } from "@/hooks/use-language";
import { confirmAction } from "@/components/confirm/confirm-store";
import { toast } from "@/components/toast/toast-store";


// Product is declared globally in src/types/electron.d.ts
// (previously this file redeclared a local copy of the same type).


export default function ProductsPage(): JSX.Element {


  const { hasPermission } = useAuth();

  const { format: formatCurrency } = useCurrency();
  const { t } = useLanguage();

  const navigate = useNavigate();



  const [searchParams, setSearchParams] =
    useSearchParams();




  const idParam = searchParams.get("id");
  const selectedId = idParam !== null ? Number(idParam) : null;






  const [products,setProducts] =
    useState<Product[]>([]);




  const [search,setSearch] =
    useState("");




  const [showModal,setShowModal] =
    useState(false);

useEscapeKey(showModal, () => setShowModal(false));

  const [formError,setFormError] =
    useState<string | null>(null);




  const [editId,setEditId] =
    useState<number|null>(null);






  const [form,setForm] = useState({

    name:"",

    category:"",

    sku:"",

    price:"",

    stock:""

  });







  async function loadProducts(){


    const data =

      await window.mooral.products.getAll();



    setProducts(data);


  }







  useEffect(()=>{


    loadProducts();


  },[]);



  useEffect(()=>{

    if(searchParams.get("action") === "add"){

      openAdd();

      const next = new URLSearchParams(searchParams);
      next.delete("action");
      setSearchParams(next, { replace:true });

    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[searchParams]);









  const selectedProduct =

    products.find(

      product =>

      product.id === selectedId

    );









  const filteredProducts =

    useMemo(()=>{


      const keyword =

        search

        .trim()

        .toLowerCase();





      if(!keyword){


        return products;


      }






      return products.filter(product=>


        (product.product_id || "")

        .toLowerCase()

        .includes(keyword)



        ||



        (product.name || "")

        .toLowerCase()

        .includes(keyword)



        ||



        (product.category || "")

        .toLowerCase()

        .includes(keyword)



        ||



        (product.sku || "")

        .toLowerCase()

        .includes(keyword)



      );



    },[products,search]);





  function openAdd(){


    setEditId(null);



    setForm({

      name:"",

      category:"",

      sku:"",

      price:"",

      stock:""

    });



    setFormError(null);
    setShowModal(true);


  }
  



  function editProduct(product:Product){


    setEditId(product.id || null);



    setForm({

      name:product.name,

      category:product.category,

      sku:product.sku,

      price:String(product.price),

      stock:String(product.stock)

    });



    setFormError(null);
    setShowModal(true);


  }







  async function saveProduct(){


    // Was a bare `return`: pressing Save with an empty name did nothing at all.
    if(!form.name.trim()){

      setFormError(t("products.nameRequired"));

      return;

    }

    setFormError(null);


    const priceValue = Number(form.price);
    const stockValue = Number(form.stock);

    if(Number.isNaN(priceValue) || priceValue < 0){
      setFormError(t("products.priceInvalid"));
      return;
    }

    if(Number.isNaN(stockValue) || stockValue < 0){
      setFormError(t("products.stockInvalid"));
      return;
    }






    const product = {

      name:form.name,

      category:form.category,

      sku:form.sku,

      price:priceValue,

      stock:stockValue

    };








    try{

      if(editId){

        await window.mooral.products.update({
          id:editId,
          product
        });

      }
      else{

        await window.mooral.products.create(
          product
        );

      }

    }
    catch(error){

      console.error("Failed to save product:", error);

      toast.error(
        t("products.saveFailed")
      );

      return;

    }




    await loadProducts();



    setShowModal(false);



  }









  async function deleteProduct(id:number){



    const confirmed = await confirmAction({
      title: t("common.delete"),
      message: t("products.confirmDelete"),
      confirmLabel: t("common.delete"),
      tone: "danger"
    });

    if(!confirmed)
      return;






    try{

      await window.mooral.products.delete(id);

      await loadProducts();

    }
    catch(error){

      console.error("Failed to delete product:", error);

      toast.error(
        t("products.deleteFailed")
      );

    }

  }












  return (



    <div className="products-page">





    {


    selectedProduct ?



    (



      <>





      <div className="products-header">





        <div>



          <h1>

            {t("products.detailsTitle")}

          </h1>




          <p>

            View product information

          </p>




        </div>








        <div

          style={{

            display:"flex",

            gap:"10px"

          }}


        >





          <button

            className="add-product"

            onClick={

              ()=>editProduct(selectedProduct)

            }


          >



            <Pencil size={18}/>


            Edit



          </button>







          <button

            className="add-product"

            onClick={

              ()=>navigate("/products")

            }


          >



            <ArrowLeft size={18}/>


            Back



          </button>





        </div>




      </div>









      <div className="product-table">





        <div className="product-table-row">


          <strong>

            Product ID

          </strong>


          <span>

            {selectedProduct.product_id}

          </span>


        </div>






        <div className="product-table-row">


          <strong>

            Name

          </strong>


          <span>

            {selectedProduct.name}

          </span>


        </div>






        <div className="product-table-row">


          <strong>

            {t("products.category")}

          </strong>


          <span>

            {selectedProduct.category}

          </span>


        </div>






        <div className="product-table-row">


          <strong>

            {t("products.sku")}

          </strong>


          <span>

            {selectedProduct.sku}

          </span>


        </div>






        <div className="product-table-row">


          <strong>

            {t("products.price")}

          </strong>


          <span>

            {formatCurrency(selectedProduct.price)}

          </span>


        </div>






        <div className="product-table-row">


          <strong>

            {t("products.stock")}

          </strong>


          <span>

            {formatNumber(selectedProduct.stock)}

          </span>


        </div>






      </div>





      </>


    )



    :



    (
	



      <>


      <div className="products-header">



        <div>


          <h1>

            {t("products.title")}

          </h1>



          <p>

            {t("products.subtitle")}

          </p>


        </div>






        {hasPermission("products.create") && (
        <button

          className="add-product"

          onClick={openAdd}

        >



          <Plus size={18}/>


          {t("products.addProduct")}



        </button>
        )}



      </div>






      <div className="product-toolbar">



        <div className="search-box">


    <Search size={18}/>



    <input


        placeholder={t("products.searchPlaceholder")}

        value={search}

        onChange={

            e =>

            setSearch(

                e.target.value

            )

        }

    />


</div>



      </div>






      <div className="product-table">



        <div className="product-table-head">


          <span>{t("products.id")}</span>

          <span>{t("products.productName")}</span>

          <span>{t("products.category")}</span>

          <span>{t("products.sku")}</span>

          <span>{t("products.price")}</span>

          <span>{t("products.stock")}</span>

          <span>{t("products.actions")}</span>


        </div>







        <div className="product-table-body">


        {

          filteredProducts.length === 0 && (


            <div className="empty-products">


              {t("products.noProductsFound")}


            </div>


          )

        }







        {


          filteredProducts.map(product=>(



            <div

              className="product-table-row"

              key={product.id}

            >





              <span>

                {product.product_id}

              </span>




              <span>

                {product.name}

              </span>




              <span>

                {product.category}

              </span>




              <span>

                {product.sku}

              </span>




              <span>

                {formatCurrency(product.price)}

              </span>




              <span>

                {formatNumber(product.stock)}

              </span>






              <span className="product-actions">



                {hasPermission("products.edit") && (
                <button

                  onClick={

                    ()=>editProduct(product)

                  }

                >

                  <Pencil size={16}/>

                </button>
                )}






                {hasPermission("products.delete") && (
                <button

                  onClick={

                    ()=>deleteProduct(product.id!)

                  }

                >


                  <Trash2 size={16}/>


                </button>
                )}




              </span>





            </div>



          ))



        }



        </div>






      </div>




      </>



    )


    }



    {

      showModal &&





      <div className="modal-overlay">



        <div className="product-modal">





          <div className="modal-header">



            <h2>


              {

                editId

                ?

                t("products.editProduct")

                :

                t("products.addProduct")


              }


            </h2>






            <button

              onClick={

                ()=>setShowModal(false)

              }


            >


              <X size={20}/>


            </button>




          </div>








          <div className="modal-body">

            <div className="form-group">
              <label>{t("products.productName")}</label>
              <input
                value={form.name}
                onChange={
                  e =>
                  setForm({
                    ...form,
                    name:e.target.value
                  })
                }
              />
            </div>

            <div className="form-row">

              <div className="form-group">
                <label>{t("products.category")}</label>
                <input
                  value={form.category}
                  onChange={
                    e =>
                    setForm({
                      ...form,
                      category:e.target.value
                    })
                  }
                />
              </div>

              <div className="form-group">
                <label>{t("products.sku")}</label>
                <input
                  value={form.sku}
                  onChange={
                    e =>
                    setForm({
                      ...form,
                      sku:e.target.value
                    })
                  }
                />
              </div>

            </div>

            <div className="form-row">

              <div className="form-group">
                <label>{t("products.price")}</label>
                <input
                  type="number"
                  min="0"
                  value={form.price}
                  onChange={
                    e =>
                    setForm({
                      ...form,
                      price:e.target.value
                    })
                  }
                />
              </div>

              <div className="form-group">
                <label>{t("products.stock")}</label>
                <input
                  type="number"
                  min="0"
                  value={form.stock}
                  onChange={
                    e =>
                    setForm({
                      ...form,
                      stock:e.target.value
                    })
                  }
                />
              </div>

            </div>

            {formError && (

              <p className="form-error" role="alert">{formError}</p>

            )}

            <button

              className="save-product"

              onClick={saveProduct}


            >


              {t("products.saveProduct")}



            </button>

          </div>







        </div>



      </div>



    }





    </div>



  );


}