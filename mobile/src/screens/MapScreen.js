// "Near me" — a free OpenStreetMap (Leaflet in a WebView, no API key / no Google)
// showing the user's location, a selectable radius, and venue pins within it.
// Tapping a pin's "View venue" opens the detail. Falls back to Karachi centre if
// location permission is denied.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { C } from '../theme';

const KHI = { lat: 24.8607, lng: 67.0011 };
const RADII = [1, 3, 5, 10];

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function buildHTML(center, radiusKm, items) {
  const zoom = radiusKm <= 1 ? 15 : radiusKm <= 3 ? 14 : radiusKm <= 5 ? 13 : 12;
  const markers = items.filter((v) => v.latitude && v.longitude).map((v) =>
    `addPin(${v.latitude},${v.longitude},${JSON.stringify(esc(v.name))},${JSON.stringify(esc(v.area || ''))},${v.dist},${JSON.stringify(v.slug)});`).join('\n');
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#map{height:100%;margin:0;padding:0}.leaflet-popup-content{font-family:-apple-system,Roboto,sans-serif}.vlink{color:#A6324F;font-weight:700;text-decoration:none}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var center=[${center.lat},${center.lng}], radius=${radiusKm * 1000};
var map=L.map('map',{zoomControl:true,attributionControl:false}).setView(center,${zoom});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
L.circle(center,{radius:radius,color:'#A6324F',weight:1,fillColor:'#A6324F',fillOpacity:0.07}).addTo(map);
L.circleMarker(center,{radius:8,color:'#fff',weight:3,fillColor:'#2D7FF9',fillOpacity:1}).addTo(map).bindPopup('You are here');
var pin=L.divIcon({className:'',iconSize:[18,18],iconAnchor:[9,9],html:'<div style="width:16px;height:16px;border-radius:50% 50% 50% 0;background:#A6324F;border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>'});
function sel(s){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s); }
function addPin(lat,lng,name,area,dist,slug){
  var m=L.marker([lat,lng],{icon:pin}).addTo(map);
  m.bindPopup('<b>'+name+'</b><br>'+(area?area+' · ':'')+dist+' km<br><a class="vlink" href="#" onclick="sel(\\''+slug+'\\');return false;">View venue →</a>');
}
${markers}
try{ map.fitBounds(L.circle(center,{radius:radius}).getBounds(),{padding:[20,20]}); }catch(e){}
</script></body></html>`;
}

export default function MapScreen({ navigation }) {
  const [center, setCenter] = useState(KHI);
  const [radius, setRadius] = useState(5);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [html, setHtml] = useState(null);
  const insets = useSafeAreaInsets();

  // Get location once.
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {}
    })();
  }, []);

  const fetchNear = useCallback(async (c, r) => {
    setLoading(true);
    try {
      const res = await api.near({ lat: c.lat, lng: c.lng, radius: r });
      const list = res.items || [];
      setItems(list);
      setHtml(buildHTML(c, r, list));
    } catch { setHtml(buildHTML(c, r, [])); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchNear(center, radius); }, [center, radius, fetchNear]);

  return (
    <View style={styles.fill}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Near me</Text>
          <Text style={styles.sub}>{loading ? 'Finding venues…' : `${items.length} within ${radius} km`}</Text>
        </View>
      </View>

      <View style={styles.mapWrap}>
        {html
          ? <WebView originWhitelist={['*']} source={{ html }} style={styles.web} onMessage={(e) => { const slug = e.nativeEvent.data; if (slug) navigation.navigate('Venue', { slug }); }} />
          : <View style={styles.center}><ActivityIndicator color={C.primary} size="large" /></View>}
        {loading && html && <View style={styles.badge}><ActivityIndicator color="#fff" size="small" /></View>}
      </View>

      <View style={[styles.radii, { paddingBottom: insets.bottom + 10 }]}>
        <Text style={styles.radLabel}>Radius</Text>
        {RADII.map((r) => (
          <TouchableOpacity key={r} style={[styles.rchip, radius === r && styles.rchipOn]} onPress={() => setRadius(r)} activeOpacity={0.8}>
            <Text style={[styles.rtext, radius === r && styles.rtextOn]}>{r} km</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  back: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: C.text },
  sub: { fontSize: 12.5, color: C.muted, marginTop: 1 },
  mapWrap: { flex: 1 },
  web: { flex: 1, backgroundColor: '#e8e8e8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 12, right: 12, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  radii: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line },
  radLabel: { color: C.muted, fontWeight: '700', fontSize: 13, marginRight: 2 },
  rchip: { paddingHorizontal: 16, height: 38, borderRadius: 999, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  rchipOn: { backgroundColor: C.primary, borderColor: C.primary },
  rtext: { color: C.text, fontWeight: '700', fontSize: 13.5 },
  rtextOn: { color: '#fff' },
});
