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

import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { confirmAction } from "@/components/confirm/confirm-store";
import { toast } from "@/components/toast/toast-store";

import "./customers.css";

// Customer is declared globally in src/types/electron.d.ts
// (previously this file redeclared a local copy of the same type).

export default function CustomersPage(): JSX.Element {


const { hasPermission } = useAuth();
const { t } = useLanguage();


const navigate = useNavigate();


const [searchParams, setSearchParams] = useSearchParams();


const idParam = searchParams.get("id");
const selectedId = idParam !== null ? Number(idParam) : null;



const [customers,setCustomers] =
useState<Customer[]>([]);



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

phone:"",

email:"",

address:""

});







async function loadCustomers(){


const data =
await window.mooral.customers.getAll();


setCustomers(data);


}





useEffect(()=>{


loadCustomers();


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








const selectedCustomer =
customers.find(

customer =>

customer.id === selectedId

);







const filteredCustomers =
useMemo(()=>{


const keyword =
search.trim().toLowerCase();




if(!keyword)

return customers;





return customers.filter(customer =>


(customer.customer_id || "")
.toLowerCase()
.includes(keyword)



||


(customer.name || "")
.toLowerCase()
.includes(keyword)



||


(customer.phone || "")
.toLowerCase()
.includes(keyword)



||


(customer.email || "")
.toLowerCase()
.includes(keyword)



);



},[customers,search]);









function openAdd(){


setEditId(null);


setForm({

name:"",

phone:"",

email:"",

address:""

});


setFormError(null);
setShowModal(true);


}








function editCustomer(customer:Customer){


setEditId(customer.id || null);


setForm({

name:customer.name,

phone:customer.phone,

email:customer.email,

address:customer.address

});


setFormError(null);
setShowModal(true);


}








async function saveCustomer(){


// Previously this was a bare `return`, so pressing Save with an empty Name
// produced no visible reaction at all. Tell the user what is missing.
if(!form.name.trim()){

  setFormError(t("customers.nameRequired"));

  return;

}

setFormError(null);





const customer = {

name:form.name,

phone:form.phone,

email:form.email,

address:form.address


};





try{

  if(editId){

    await window.mooral.customers.update({
      id:editId,
      customer
    });

  }
  else{

    await window.mooral.customers.create(customer);

  }

}
catch(error){

  console.error("Failed to save customer:", error);

  setFormError(
    t("customers.saveFailed")
  );

  return;

}


await loadCustomers();


setShowModal(false);


}








async function deleteCustomer(id:number){


const confirmed = await confirmAction({
  title: t("common.delete"),
  message: t("customers.confirmDelete"),
  confirmLabel: t("common.delete"),
  tone: "danger"
});

if(!confirmed)

return;



try{

await window.mooral.customers.delete(id);


await loadCustomers();

}
catch(error){

console.error("Failed to delete customer:", error);

toast.error(
  t("customers.deleteFailed")
);

}


}








return (

<div className="customers-page">



{


selectedCustomer ?



<>


<div className="customers-header">


<div>

<h1>

{t("customers.detailsTitle")}

</h1>


<p>

View customer information

</p>


</div>



<div className="customer-detail-actions">

{hasPermission("customers.edit") && (
<button

className="add-customer"

onClick={()=>editCustomer(selectedCustomer)}

>

<Pencil size={18}/>

Edit

</button>
)}



<button

className="add-customer"

onClick={()=>navigate("/customers")}

>

<ArrowLeft size={18}/>

Back

</button>



</div>


</div>






<div className="customer-details-card">


<div>

<strong>{t("customers.id")}</strong>

<span>{selectedCustomer.customer_id}</span>

</div>


<div>

<strong>{t("customers.name")}</strong>

<span>{selectedCustomer.name}</span>

</div>


<div>

<strong>{t("customers.phone")}</strong>

<span>{selectedCustomer.phone}</span>

</div>


<div>

<strong>{t("customers.email")}</strong>

<span>{selectedCustomer.email}</span>

</div>


<div>

<strong>{t("customers.address")}</strong>

<span>{selectedCustomer.address}</span>

</div>


</div>


</>



:





<>



<div className="customers-header">


<div>

<h1>

{t("customers.title")}

</h1>


<p>

{t("customers.subtitle")}

</p>


</div>




{hasPermission("customers.create") && (
<button

className="add-customer"

onClick={openAdd}

>

<Plus size={18}/>

{t("customers.addCustomer")}

</button>
)}



</div>







<div className="customer-toolbar">


<div className="search-box">


<Search size={18}/>


<input
    type="text"
    placeholder={t("customers.searchPlaceholder")}
    value={search}
    onChange={(e) => setSearch(e.target.value)}
/>



</div>


</div>








<div className="customer-cards">



{


filteredCustomers.map(customer=>(


<div

className="customer-card"

key={customer.id}

>




<div className="customer-card-top">


<div>


<h2>

{customer.name}

</h2>


<p>

{customer.customer_id}

</p>


</div>


<div className="customer-actions">


{hasPermission("customers.edit") && (
<button

onClick={()=>editCustomer(customer)}

>

<Pencil size={16}/>

</button>
)}


{hasPermission("customers.delete") && (
<button

onClick={()=>deleteCustomer(customer.id!)}

>

<Trash2 size={16}/>

</button>
)}


</div>


</div>






<div className="customer-info">


<div>

<label>
{t("customers.phone")}
</label>

<span>
{customer.phone || "-"}
</span>

</div>



<div>

<label>
{t("customers.email")}
</label>

<span>
{customer.email || "-"}
</span>

</div>



<div>

<label>
{t("customers.address")}
</label>

<span>
{customer.address || "-"}
</span>

</div>


</div>



</div>


))


}


{

filteredCustomers.length === 0 && (

<div className="empty-customers">

{t("customers.noCustomersFound")}

</div>

)

}


</div>



</>



}







{


showModal &&



<div className="modal-overlay">


<div className="customer-modal">



<div className="modal-header">


<h2>

{

editId

?

t("customers.editCustomer")

:

t("customers.addCustomer")

}

</h2>




<button

onClick={()=>setShowModal(false)}

>

<X size={20}/>

</button>



</div>





<input

placeholder={t("customers.name")}

value={form.name}

onChange={
e=>setForm({

...form,

name:e.target.value

})
}

/>



<input

placeholder={t("customers.phone")}

value={form.phone}

onChange={
e=>setForm({

...form,

phone:e.target.value

})
}

/>



<input

placeholder={t("customers.email")}

value={form.email}

onChange={
e=>setForm({

...form,

email:e.target.value

})
}

/>



<input

placeholder={t("customers.address")}

value={form.address}

onChange={
e=>setForm({

...form,

address:e.target.value

})
}

/>

	{formError && (

	  <p className="form-error" role="alert">{formError}</p>

	)}

	<button

	className="save-customer"

	onClick={saveCustomer}

	>

	{t("customers.saveCustomer")}

	</button>



</div>


</div>


}





</div>


);


}