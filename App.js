import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Linking, Pressable, Switch, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Access, api, alertError, bdt, Btn, Busy, Chips, Collection, color, Content, dateText, Deletion, enablePush, ErrorBox,
  Field, Picture, s, statusText, Title, useNotificationOpen, usePage, useSession } from './common';

const statuses=['','Pending','Confirmed','Processing','Shipped','Delivered','Cancelled','Returned'];
const nextStatus={Pending:'Confirmed',Confirmed:'Processing',Processing:'Shipped',Shipped:'Delivered'};
function Dashboard({token}) {
  const [data,setData]=useState(null);
  const [error,setError]=useState(null);
  const [revision,refresh]=useState(0);
  useEffect(()=>{
    const ctrl=new AbortController();
    setError(null);setData(null);
    api('seller_dashboard',{token,signal:ctrl.signal}).then(d=>{if(!ctrl.signal.aborted)setData(d);})
      .catch(e=>{if(!ctrl.signal.aborted)setError(e);});
    return ()=>ctrl.abort();
  },[token,revision]);
  return <Content><Title>Shop dashboard</Title>
    {error?<ErrorBox error={error} retry={()=>refresh(n=>n+1)}/>:!data?<Busy/>:<>
      <View style={s.row}>
        {[["Today's orders",data.today_orders],['Pending COD orders',data.pending_orders],['Delivered merchandise sales',bdt(data.sales)],['Active listings',data.active_products]]
          .map(([label,value])=><View key={label} style={[s.card,{flexGrow:1,flexBasis:145}]}>
            <Text style={s.muted}>{label}</Text><Text style={s.title}>{value}</Text>
          </View>)}
      </View>
      <Btn title="Refresh dashboard" secondary onPress={()=>refresh(n=>n+1)}/>
    </>}
  </Content>;
}
function ProductList({token,edit}) {
  const page=usePage('seller_products',{},token);
  const categories=page.meta.categories||[];
  return <Collection page={page} empty="You have no products."
    header={<><Title>My products</Title><Btn title="Add product" disabled={!categories.length} onPress={()=>edit(null,categories)}/></>}
    renderItem={({item:p})=><View style={s.card}>
      <View style={s.row}>
        <Picture uri={p.image} style={{width:64}}/>
        <View style={{flex:1,gap:4}}>
          <Text style={s.label}>{p.title}</Text>
          <Text style={s.text}>{bdt(p.discount_price??p.price)} · Stock {p.stock}</Text>
          <Text style={s.muted}>{p.approval_status} · {Number(p.active)===1?'Listing enabled':'Listing disabled'}</Text>
        </View>
      </View>
      <Btn title="Edit product" secondary onPress={()=>edit(p,categories)}/>
    </View>}/>;
}
function EditProduct({token,product,categories,onSave}) {
  const [form,setForm]=useState({
    title:product?.title||'',title_bn:product?.title_bn||'',description:product?.description||'',
    price:String(product?.price??''),discount_price:String(product?.discount_price??''),
    stock:String(product?.stock??''), category_id:String(product?.category_id??''), active:product?Number(product.active)===1:true,
  });
  const [photo,setPhoto]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  const lock=useRef(false);
  const set=(key,value)=>setForm(old=>({...old,[key]:value}));
  const field=(name,label,props={})=><Field label={label} value={form[name]} editable={!busy} onChangeText={value=>set(name,value)} {...props}/>;
  async function pick() {
    try {
      const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:true,quality:0.8,exif:false});
      if(result.canceled)return;
      const asset=result.assets[0];
      const image=ImageManipulator.manipulate(asset.uri);
      if(Math.max(asset.width,asset.height)>2000) {
        image.resize(asset.width>=asset.height?{width:2000}:{height:2000});
      }
      const rendered=await image.renderAsync();
      const jpeg=await rendered.saveAsync({compress:0.82,format:SaveFormat.JPEG});
      setPhoto({uri:jpeg.uri,type:'image/jpeg',name:'photo.jpg'});
      setError(null);
    } catch(e){setError(e);}
  }
  async function save() {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError(null);
    try {
      const body=new FormData();
      for(const [key,value] of Object.entries(form)) body.append(key,key==='active'?(value?'1':'0'):value);
      if(product) {body.append('id',String(product.id));body.append('revision',product.revision);}
      if(photo)body.append('image',photo);
      const result=await api('seller_products',{token,body});
      Alert.alert(result.approval_status==='pending'?'Product saved for review':'Product saved');
      onSave();
    } catch(e){setError(e);}
    finally{lock.current=false;setBusy(false);}
  }
  return <Content><Title>{product?'Edit product':'Add product'}</Title>
    {(photo||product?.image)&&<Picture uri={photo?.uri||product.image} style={{width:150}}/>}
    <Btn title={photo||product?.image?'Replace photo':'Choose photo'} secondary disabled={busy} onPress={pick}/>
    {field('title','Product name')}
    {field('title_bn','Product name in Bangla (optional)')}
    {field('description','Description',{multiline:true})}
    <Text style={s.label}>Category</Text>
    <Chips options={categories.map(c=>({id:String(c.id),label:c.name}))} value={form.category_id}
      onChange={value=>{if(!busy)set('category_id',value);}}/>
    {field('price','Regular price (৳)',{keyboardType:'decimal-pad'})}
    {field('discount_price','Sale price (৳, optional)',{keyboardType:'decimal-pad'})}
    {field('stock','Stock quantity',{keyboardType:'number-pad'})}
    <View style={s.row}><Text style={s.label}>In-stock listing enabled</Text>
      <Switch accessibilityLabel="In-stock listing enabled" value={form.active} onValueChange={value=>set('active',value)} disabled={busy}
        trackColor={{true:color.green,false:color.line}}/>
    </View>
    {error&&<ErrorBox error={error}/>}
    <Btn title="Save product" disabled={busy||!form.title.trim()||!form.category_id||!form.price||!form.stock||(!product&&!photo)} onPress={save}/>
  </Content>;
}
function Orders({token}) {
  const [status,setStatus]=useState('');
  const [updating,setUpdating]=useState(null);
  const lock=useRef(false);
  const page=usePage('seller_orders',{status},token);
  async function update(order) {
    if(lock.current)return;
    lock.current=true;setUpdating(order.id);
    try {await api('seller_orders',{token,body:{id:order.id,status:nextStatus[order.status]}});page.refresh();}
    catch(e){alertError(e);page.refresh();}
    finally{lock.current=false;setUpdating(null);}
  }
  return <Collection page={page} empty="No orders in this view."
    header={<><Title>COD orders</Title><Chips value={status} onChange={setStatus}
      options={statuses.map(id=>({id,label:id?statusText(id,false):'All orders'}))}/></>}
    renderItem={({item:o})=><View style={s.card}>
      <Text selectable style={s.label}>{o.reference} · {statusText(o.status,false)}</Text>
      <Text style={s.muted}>{dateText(o.created_at,false)}</Text>
      <Text style={s.text}>{o.name}</Text>
      <Pressable accessibilityRole="link" onPress={()=>Linking.openURL('tel:'+o.phone).catch(alertError)}>
        <Text style={{color:color.green,textDecorationLine:'underline',minHeight:32}}>{o.phone}</Text>
      </Pressable>
      <Text selectable style={s.text}>{o.address}</Text>
      {o.items.map((line,index)=><Text key={index} style={s.muted}>{line.quantity} × {line.title} · {bdt(line.unit_price)}</Text>)}
      {!!o.tracking_number&&<Text style={s.text}>Courier tracking · {o.tracking_number}</Text>}
      <Text style={s.label}>COD {bdt(o.total)} · delivery {bdt(o.delivery_fee)}</Text>
      {nextStatus[o.status]&&<Btn title={'Mark '+statusText(nextStatus[o.status],false).toLowerCase()}
        disabled={updating!==null} onPress={()=>update(o)}/>}
    </View>}/>;
}
function Account({auth}) {
  async function push() {
    try {
      const yes=await enablePush('seller_auth',auth.session.token);
      Alert.alert(yes?'Order notifications enabled':'Notification permission is off');
    } catch(e){alertError(e);}
  }
  return <Content><Title>{auth.session.name}</Title>
    <Btn title="Enable new-order notifications" secondary onPress={push}/>
    <Btn title="Sign out" secondary onPress={()=>auth.logout().catch(alertError)}/>
    <Deletion endpoint="seller_auth" token={auth.session.token} onDeleted={()=>auth.save(null)}/>
  </Content>;
}
function SellerCenter() {
  const auth=useSession('seller_auth');
  const [tab,setTab]=useState('Dashboard');
  const [editing,setEditing]=useState(null);
  const back=useCallback(()=>{if(!editing)return false;setEditing(null);return true;},[editing]);
  useEffect(()=>{const listener=BackHandler.addEventListener('hardwareBackPress',back);return()=>listener.remove();},[back]);
  const notification=useCallback(screen=>{if(screen==='Orders'){setEditing(null);setTab('Orders');}},[]);
  useNotificationOpen(notification);
  const token=auth.session?.token;
  useEffect(()=>{
    if (!token) return;
    const controller=new AbortController();
    api('seller_dashboard',{token,signal:controller.signal}).catch(error=>{
      if(!controller.signal.aborted && error.status===401) auth.save(null).catch(alertError);
    });
    return ()=>controller.abort();
  },[token]);
  let screen;
  if(!auth.ready)screen=<Busy/>;
  else if(!token)screen=<Content><Access role="seller" onLogin={auth.save}/></Content>;
  else if(editing)screen=<EditProduct token={token} product={editing.product} categories={editing.categories} onSave={()=>setEditing(null)}/>;
  else if(tab==='Dashboard')screen=<Dashboard token={token}/>;
  else if(tab==='Products')screen=<ProductList token={token} edit={(product,categories)=>setEditing({product,categories})}/>;
  else if(tab==='Orders')screen=<Orders token={token}/>;
  else screen=<Account auth={auth}/>;
  return <SafeAreaView style={s.screen}>
    <View style={[s.header,{backgroundColor:'#122c46'}]}>
      {editing&&<Btn title="‹ Back" onPress={back} secondary/>}
      <Text style={s.logo}>COD Seller Center</Text>
    </View>
    <View style={{flex:1}}>{screen}</View>
    {!!token&&!editing&&<View style={{flexDirection:'row',backgroundColor:color.white,borderTopWidth:1,borderTopColor:color.line}}>
      {['Dashboard','Products','Orders','Account'].map(key=><Pressable key={key} accessibilityRole="tab"
         accessibilityState={{selected:tab===key}} onPress={()=>setTab(key)}
         style={{flex:1,minHeight:52,alignItems:'center',justifyContent:'center',backgroundColor:tab===key?color.pale:color.white}}>
        <Text style={[s.label,{fontSize:12}]}>{key}</Text>
      </Pressable>)}
    </View>}
  </SafeAreaView>;
}
export default function App(){return <SafeAreaProvider><SellerCenter/></SafeAreaProvider>;}
