import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';

const apiBase = (Constants.expoConfig?.extra?.api || 'https://www.cod.com.bd/api/v1').replace(/\/+$/, '') + '/';
const tokenKey = 'cod.session';
export const color = { green:'#075545', pale:'#e7f4ec', ink:'#132a25', muted:'#49615b', line:'#cbded5', paper:'#f3f7f5', white:'#fff', red:'#aa2525' };
export const bdt = (value, bn = false) => '৳' + new Intl.NumberFormat(bn ? 'bn-BD' : 'en-BD', { minimumFractionDigits:2, maximumFractionDigits:2 }).format(Number(value));
export const statusText = (status, bn) => {
  if (!bn) return status === 'Processing' ? 'Packed' : status;
  return ({Pending:'অপেক্ষমাণ',Confirmed:'নিশ্চিত',Processing:'প্যাক করা হয়েছে',Shipped:'পাঠানো হয়েছে',Delivered:'ডেলিভারি হয়েছে',Cancelled:'বাতিল',Returned:'ফেরত'})[status] || status;
};
export const dateText = (value, bn) => {
  if (!value) return '';
  const time = new Date(value.replace(' ', 'T') + (value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? '' : 'Z'));
  return Number.isNaN(time.getTime()) ? value : new Intl.DateTimeFormat(bn?'bn-BD':'en-BD',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Dhaka'}).format(time);
};
const messages = {
  'Sign in again.':'আবার সাইন ইন করুন।',
  'Check your email and password.':'ইমেইল ও পাসওয়ার্ড যাচাই করুন।',
  'Enter a valid Bangladesh mobile number.':'সঠিক বাংলাদেশি মোবাইল নম্বর দিন।',
  'An item has insufficient stock. Update your cart.':'একটি পণ্যের পর্যাপ্ত স্টক নেই। কার্ট আপডেট করুন।',
  'Prices changed. Review the updated total.':'দাম পরিবর্তন হয়েছে। নতুন মোট মূল্য দেখুন।',
  'Order unavailable. Check your Order ID and phone.':'অর্ডার পাওয়া যায়নি। আইডি ও মোবাইল নম্বর যাচাই করুন।',
  'Cannot reach COD.com.bd. Check your connection and retry.':'COD.com.bd-এ সংযোগ করা যাচ্ছে না। ইন্টারনেট সংযোগ যাচাই করে আবার চেষ্টা করুন।',
  'Service temporarily unavailable.':'সেবা সাময়িকভাবে বন্ধ আছে।',
  'Too many attempts. Try again later.':'অনেকবার চেষ্টা করা হয়েছে। পরে আবার চেষ্টা করুন।',
};
export const localizedError = (e, bn) => bn ? messages[e.message] || e.message : e.message;
export function alertError(e, bn = false) { Alert.alert(bn?'অনুরোধ সম্পন্ন হয়নি':'Could not complete the request',localizedError(e,bn)); }
export async function api(file, { token, params = {}, body, signal } = {}) {
  const query = Object.entries(params).filter(([, value]) => value !== '' && value !== undefined && value !== null)
    .map(([key,value]) => encodeURIComponent(key)+'='+encodeURIComponent(value)).join('&');
  const headers = { Accept:'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const form = body instanceof FormData;
  if (body && !form) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once:true });
  const timer = setTimeout(abort, 20000);
  try {
    let response;
    try {
      response = await fetch(apiBase + file + '.php' + (query?'?'+query:''), {
        method:body?'POST':'GET', headers, signal:controller.signal,
        body:body ? form ? body : JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Cannot reach COD.com.bd. Check your connection and retry.');
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !Object.keys(json).length) {
      const error = new Error(json.error || 'Service temporarily unavailable.');
      error.status = response.status;
      throw error;
    }
    return json;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:false,shouldSetBadge:false}),
});
export function useNotificationOpen(callback) {
  useEffect(() => {
    const handle = (response) => {
      if (!response) return;
      callback(response.notification.request.content.data.screen);
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
    return () => sub.remove();
  }, [callback]);
}
export async function enablePush(endpoint, token) {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('orders', {
    name:'Orders', importance:Notifications.AndroidImportance.DEFAULT,
  });
  const existing = await Notifications.getPermissionsAsync();
  const result = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (!result.granted) {
    if (!result.canAskAgain) await Linking.openSettings();
    return false;
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Push notifications require a linked EAS project.');
  const device = await Notifications.getExpoPushTokenAsync({projectId});
  await api(endpoint,{token,body:{action:'push',token:device.data}});
  return true;
}
export function useSession(endpoint) {
  const [session,setSession] = useState(null);
  const [ready,setReady] = useState(false);
  useEffect(() => {
    SecureStore.getItemAsync(tokenKey).then(s => {if(s) setSession(JSON.parse(s));}).catch(alertError)
      .finally(() => setReady(true));
  }, []);
  async function save(next) {
    if (next) await SecureStore.setItemAsync(tokenKey, JSON.stringify(next));
    else await SecureStore.deleteItemAsync(tokenKey);
    setSession(next);
  }
  async function logout() {
    try { await api(endpoint,{token:session.token,body:{action:'logout'}}); }
    catch (e) { if (e.status!==401) throw e; }
    await save(null);
  }
  return {session,ready,save,logout};
}
export function useActive(callback) {
  useEffect(() => {
    const listener=AppState.addEventListener('change', state => { if(state==='active') callback(); });
    return () => listener.remove();
  },[callback]);
}
export function Btn({title,onPress,secondary=false,disabled=false,danger=false,style}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed}) => [s.button,secondary && s.secondary,danger && s.danger,disabled && s.disabled,pressed && s.pressed,style]}>
    <Text style={[s.buttonText,secondary && s.secondaryText,danger && s.dangerText]}>{title}</Text>
  </Pressable>;
}
export function Field({label, value, onChangeText, ...props}) {
  return <View style={s.field}><Text style={s.label}>{label}</Text>
    <TextInput accessibilityLabel={label} placeholderTextColor={color.muted} value={value}
      onChangeText={onChangeText} style={[s.input,props.multiline && {minHeight:90,textAlignVertical:'top'}]} {...props}/>
  </View>;
}
export function Picture({uri,style}) {
  return uri ? <Image accessibilityIgnoresInvertColors source={{uri}} style={[s.picture,style]} resizeMode="cover"/>
    : <View style={[s.picture,style,s.center]}><Text style={s.muted}>COD</Text></View>;
}
export function Title({children}) { return <Text accessibilityRole="header" style={s.title}>{children}</Text>; }
export function ErrorBox({error,retry,bn=false}) {
  return <View style={s.card}><Text accessibilityRole="alert" style={s.error}>{localizedError(error,bn)}</Text>
    {retry && <Btn title={bn?'আবার চেষ্টা করুন':'Retry'} onPress={retry} secondary/>}</View>;
}
export function Content({children}) {
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>{children}</ScrollView>;
}
export function Busy() {return <ActivityIndicator style={{margin:24}} color={color.green}/>;}
export function Chips({options, value, onChange}) {
  return <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}
    contentContainerStyle={s.chips}>{options.map(item =>
    <Btn key={String(item.id)} title={item.label} secondary={String(item.id)!==String(value)} onPress={() => onChange(item.id)}/>)}</ScrollView>;
}
export function Access({role,bn=false,onLogin}) {
  const t=(a,b)=>bn?b:a;
  const seller=role==='seller';
  const [register,setRegister]=useState(false);
  const [form,setForm]=useState({email:'',password:'',name:'',shop_name:'',phone:'',address:''});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  const endpoint=seller?'seller_auth':'auth';
  const field=(key,label,props={}) => <Field label={label} value={form[key]} onChangeText={value=>setForm(old=>({...old,[key]:value}))} {...props}/>;
  async function submit() {
    if (busy) return;
    setBusy(true);setError(null);
    try {
      const response=await api(endpoint,{body:{...form,action:register?'register':'login'}});
      if (register) {
        setRegister(false);
        setForm(old=>({...old,password:''}));
        Alert.alert(t('Account created','অ্যাকাউন্ট তৈরি হয়েছে'),seller?'Sign in once your marketplace application has been approved.':t('You can now sign in.','এখন সাইন ইন করুন।'));
      } else await onLogin(response);
    } catch(e) { setError(e); }
    finally { setBusy(false); }
  }
  return <View style={s.card}>
    <Title>{register?t(seller?'Register a shop':'Create account','অ্যাকাউন্ট তৈরি করুন'):t('Sign in','সাইন ইন')}</Title>
    {register && field('name',t(seller?'Owner name':'Name','নাম'))}
    {register && seller && field('shop_name','Shop name')}
    {register && seller && field('phone','Bangladesh mobile',{keyboardType:'phone-pad'})}
    {register && seller && field('address','Shop address',{multiline:true})}
    {field('email',t('Email','ইমেইল'),{keyboardType:'email-address',autoCapitalize:'none',autoComplete:'email'})}
    {field('password',t(register?'Password (12–72 bytes)':'Password',register?'পাসওয়ার্ড (১২–৭২ বাইট)':'পাসওয়ার্ড'),{secureTextEntry:true,autoCapitalize:'none',autoComplete:register?'new-password':'current-password'})}
    {error && <ErrorBox error={error} bn={bn}/>}
    <Btn title={register?t('Register','নিবন্ধন করুন'):t('Sign in','সাইন ইন')} disabled={busy} onPress={submit}/>
    <Btn title={register?t('Back to sign in','সাইন ইনে ফিরুন'):t(seller?'Register a shop':'Create account','অ্যাকাউন্ট তৈরি করুন')}
      disabled={busy} secondary onPress={()=>{setError(null);setRegister(!register);}}/>
  </View>;
}
export function Deletion({endpoint,token,onDeleted,bn=false}) {
  const t=(a,b)=>bn?b:a;
  const [expanded,setExpanded]=useState(false);
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  async function remove() {
    setBusy(true);setError(null);
    try {
      const result=await api(endpoint,{token,body:{action:'delete',password}});
      if (result.pending) {
        setExpanded(false);setPassword('');
        Alert.alert('Deletion requested','Your seller account will close after open orders, withdrawals and your shop balance are settled.');
      } else {
        await onDeleted();
        Alert.alert(t('Account deleted','অ্যাকাউন্ট মুছে ফেলা হয়েছে'));
      }
    } catch(e) { setError(e); }
    finally { setBusy(false); }
  }
  if (!expanded) return <Btn title={t('Delete account','অ্যাকাউন্ট মুছুন')} danger onPress={()=>setExpanded(true)}/>;
  return <View style={s.card}>
    <Text style={s.text}>{t('Account access will be permanently removed. Transaction records are retained for fulfilment and accounting.','অ্যাকাউন্ট স্থায়ীভাবে মুছে যাবে। ডেলিভারি ও হিসাবের জন্য লেনদেনের রেকর্ড রাখা হবে।')}</Text>
    <Field label={t('Confirm password','পাসওয়ার্ড নিশ্চিত করুন')} value={password} onChangeText={setPassword} secureTextEntry/>
    {error && <ErrorBox error={error} bn={bn}/>}
    <Btn title={t('Permanently delete account','স্থায়ীভাবে অ্যাকাউন্ট মুছুন')} danger disabled={busy||!password} onPress={()=>
      Alert.alert(t('Delete this account?','অ্যাকাউন্ট মুছবেন?'),t('This action is permanent.','এই কাজ স্থায়ী।'),[
        {text:t('Cancel','বাতিল'),style:'cancel'},
        {text:t('Delete','মুছুন'),style:'destructive',onPress:remove},
      ])}/>
    <Btn title={t('Cancel','বাতিল')} secondary disabled={busy} onPress={()=>{setExpanded(false);setPassword('');setError(null);}}/>
  </View>;
}
export function usePage(endpoint, params, token, enabled=true) {
  const [state,setState]=useState({items:[],more:false,error:null,loading:true,page:1,meta:{}});
  const [revision,refresh]=useState(0);
  const [next,setNext]=useState(1);
  const filter=JSON.stringify(params);
  const [key,setKey]=useState('');
  useEffect(() => {
    setNext(1);
    setKey(filter+'|'+revision+'|'+token);
  },[filter,revision,token]);
  useEffect(() => {
    if (!enabled || key!==filter+'|'+revision+'|'+token) return;
    const controller=new AbortController();
    setState(old=>({...old,items:next===1?[]:old.items,loading:true,error:null,page:next}));
    api(endpoint,{token,params:{...JSON.parse(filter),page:next},signal:controller.signal}).then(result=>{
      if(!controller.signal.aborted) setState(old=>({
        items:next===1?result.items:[...old.items,...result.items.filter(item=>!old.items.some(existing=>existing.id===item.id))],
        more:result.more,error:null,loading:false,page:next,meta:result,
      }));
    }).catch(error=>{if(!controller.signal.aborted) setState(old=>({...old,error,loading:false}));});
    return ()=>controller.abort();
  },[endpoint,enabled,key,filter,revision,token,next]);
  return {...state,refresh:()=>refresh(x=>x+1),load:()=>{if(!state.loading&&state.more)setNext(state.page+1);}};
}
export function Collection({page,renderItem,header,columns=1,empty='No results',more='Load more',bn=false}) {
  return <FlatList key={columns} data={page.items} numColumns={columns} keyExtractor={item=>String(item.id)}
    contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" ListHeaderComponent={header}
    renderItem={renderItem} refreshing={page.loading&&page.page===1} onRefresh={page.refresh}
    ListEmptyComponent={!page.loading&&!page.error?<Text style={s.muted}>{empty}</Text>:null}
    ListFooterComponent={page.error?<ErrorBox error={page.error} retry={page.refresh} bn={bn}/>
      :page.loading?<Busy/>:page.more?<Btn title={more} onPress={page.load} secondary/>:null}/>;
}
export const s=StyleSheet.create({
  screen:{flex:1,backgroundColor:color.paper},
  header:{paddingHorizontal:16,paddingVertical:10,backgroundColor:color.green,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  logo:{color:color.white,fontSize:20,fontWeight:'900',flexShrink:1},
  content:{padding:14,gap:12,paddingBottom:24},
  card:{padding:13,marginBottom:8,backgroundColor:color.white,borderRadius:15,borderWidth:1,borderColor:color.line,gap:8},
  row:{flexDirection:'row',gap:8,alignItems:'center',flexWrap:'wrap'},
  title:{fontSize:22,fontWeight:'800',color:color.ink,marginBottom:4},
  text:{fontSize:15,color:color.ink},
  muted:{fontSize:14,color:color.muted},
  error:{color:color.red,fontSize:15},
  button:{minHeight:44,paddingHorizontal:13,paddingVertical:9,justifyContent:'center',alignItems:'center',backgroundColor:color.green,borderRadius:10},
  secondary:{backgroundColor:color.pale},
  danger:{backgroundColor:'#fce9e9'},
  disabled:{opacity:0.45},
  pressed:{opacity:0.76},
  buttonText:{color:color.white,fontWeight:'750',textAlign:'center',fontSize:14},
  secondaryText:{color:color.green},
  dangerText:{color:color.red},
  field:{gap:5,marginBottom:4},
  label:{fontSize:14,fontWeight:'700',color:color.ink},
  input:{minHeight:46,borderColor:color.line,borderWidth:1,borderRadius:10,paddingHorizontal:11,paddingVertical:9,color:color.ink,backgroundColor:color.white,fontSize:16},
  picture:{width:'100%',aspectRatio:1,backgroundColor:color.pale,borderRadius:10},
  center:{alignItems:'center',justifyContent:'center'},
  chips:{gap:7,paddingBottom:7,alignItems:'center'},
});
