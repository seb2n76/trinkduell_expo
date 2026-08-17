import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Modal } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";
import { isCameraScanSupported, getScanUnavailableReason, isValidEan } from "@/services/barcode";

interface BarcodeScannerProps {
  visible: boolean;
  onClose: () => void;
  /** Called once with a validated EAN. The caller does the lookup. */
  onScanned: (ean: string) => void;
  /** Shown while the caller resolves the code. */
  busy?: boolean;
}

/**
 * Camera overlay for EAN barcodes, with manual entry as a first-class
 * alternative rather than an error state — on iOS browsers it is the only
 * path (see isCameraScanSupported), and it is also what you reach for when a
 * label is scratched or the light is bad at a party.
 */
export default function BarcodeScanner({ visible, onClose, onScanned, busy }: BarcodeScannerProps) {
  const cameraSupported = isCameraScanSupported();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualMode, setManualMode] = useState(!cameraSupported);
  const [manualCode, setManualCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Cameras fire the same code many times per second; without this the
  // lookup would run dozens of times for one scan.
  const [handled, setHandled] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [windowReady, setWindowReady] = useState(false);

  useEffect(() => {
    if (visible) {
      setHandled(false);
      setError(null);
      setManualCode("");
      setManualMode(!cameraSupported);
      setTorchOn(false);
      setZoom(0);
    } else {
      // Zurücksetzen, damit beim nächsten Öffnen wieder auf onShow gewartet
      // wird — sonst startet die Kamera beim zweiten Mal zu früh.
      setWindowReady(false);
    }
  }, [visible, cameraSupported]);

  // Ask for camera access as soon as the overlay opens, so the viewfinder is
  // live by the time the user points the phone at a bottle.
  useEffect(() => {
    if (visible && cameraSupported && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, cameraSupported, permission, requestPermission]);

  const submit = (raw: string) => {
    if (handled || busy) return;
    if (!isValidEan(raw)) {
      setError("Das sieht nicht nach einem gültigen Barcode aus. Bitte prüfe die Ziffern.");
      return;
    }
    setHandled(true);
    triggerHaptic("success");
    onScanned(raw.trim());
  };

  // Die Kamera erst starten, wenn das Modal-Fenster wirklich steht. Auf
  // Android ist ein RN-Modal ein eigenes Fenster; startet die CameraX-Vorschau
  // vor dessen Layout, bekommt sie keine brauchbaren Maße — und genau dann
  // fokussiert sie nicht mehr richtig oder gar nicht. Das war die
  // wahrscheinlichste Ursache für den nicht funktionierenden Autofokus.
  const showCamera = cameraSupported && !manualMode && permission?.granted && windowReady;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onShow={() => setWindowReady(true)}
    >
      <View className="flex-1 bg-slate-950">
        <View className="flex-row items-center justify-between px-5 pt-14 pb-4">
          <Text className="text-white text-base font-black">Barcode scannen</Text>
          <TouchableOpacity onPress={onClose} className="w-9 h-9 items-center justify-center rounded-xl bg-white/5 border border-white/10">
            <Ionicons name="close" size={18} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {showCamera ? (
          <View className="flex-1">
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              // NICHT auf "on" ändern. Die Bedeutung ist entgegen dem Namen
              // invertiert: "on" fokussiert EINMAL und sperrt dann, "off"
              // fokussiert laufend nach. Für einen Scanner, bei dem man das
              // Handy an die Flasche heranbewegt, ist genau das nötig.
              // (iOS-only; auf Android steuert CameraX den Fokus selbst.)
              autofocus="off"
              enableTorch={torchOn}
              zoom={zoom}
              barcodeScannerSettings={{
                // Product barcodes only. Narrowing the list keeps the decoder
                // from spending time on QR and industrial formats.
                barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"],
              }}
              onBarcodeScanned={handled || busy ? undefined : ({ data }) => submit(data)}
            />

            {/* Viewfinder frame */}
            <View className="absolute inset-0 items-center justify-center pointer-events-none">
              <View className="w-64 h-40 border-2 border-cyan-400/80 rounded-2xl" />
              <Text className="text-white text-xs font-bold mt-4 px-8 text-center">
                {busy ? "Getränk wird gesucht…" : "Halte den Barcode in den Rahmen"}
              </Text>
              <Text className="text-slate-400 text-[10px] font-semibold mt-2 px-10 text-center">
                Etwa 15–20 cm Abstand. Fokussiert die Kamera nicht, hilft meist
                mehr Licht oder ein kurzes Wegschwenken und Zurückkommen.
              </Text>
              {busy && <ActivityIndicator color="#22d3ee" className="mt-3" />}
            </View>

            {/* Licht und Zoom: die beiden häufigsten Gründe, warum der Fokus
                nicht greift — zu dunkel, oder der Code zu klein im Bild. */}
            <View className="absolute top-4 right-5 flex-row">
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic("light");
                  setTorchOn((on) => !on);
                }}
                accessibilityLabel={torchOn ? "Licht ausschalten" : "Licht einschalten"}
                className={`w-11 h-11 items-center justify-center rounded-2xl border ${
                  torchOn ? "bg-cyan-400/20 border-cyan-400/50" : "bg-slate-900/90 border-white/10"
                }`}
              >
                <Ionicons
                  name={torchOn ? "flashlight" : "flashlight-outline"}
                  size={18}
                  color={torchOn ? "#22d3ee" : "#94a3b8"}
                />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  triggerHaptic("light");
                  // Drei Stufen reichen; ein Schieber wäre eine zusätzliche
                  // Abhängigkeit für wenig Gewinn.
                  setZoom((z) => (z >= 0.4 ? 0 : z + 0.2));
                }}
                accessibilityLabel="Zoom ändern"
                className="ml-2 w-11 h-11 items-center justify-center rounded-2xl bg-slate-900/90 border border-white/10"
              >
                <Text className="text-slate-300 text-[10px] font-black">
                  {zoom === 0 ? "1x" : `${(1 + zoom * 5).toFixed(1)}x`}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => setManualMode(true)}
              className="absolute bottom-10 self-center bg-slate-900/90 border border-white/10 px-5 py-3 rounded-2xl"
            >
              <Text className="text-cyan-400 text-[11px] font-black uppercase tracking-wider">
                Stattdessen eintippen
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="flex-1 px-6 pt-4">
            {!cameraSupported && (
              <View className="bg-amber-400/10 border border-amber-400/20 rounded-2xl p-4 mb-5 flex-row">
                <Ionicons name="information-circle-outline" size={18} color="#fbbf24" />
                <Text className="text-amber-300/90 text-[11px] leading-4 ml-2.5 flex-1">
                  {getScanUnavailableReason()}
                </Text>
              </View>
            )}

            {cameraSupported && permission && !permission.granted && (
              <View className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-5">
                <Text className="text-slate-300 text-[11px] leading-4 mb-3">
                  Ohne Kamerazugriff können wir den Barcode nicht lesen. Du kannst ihn auch von
                  Hand eingeben.
                </Text>
                <TouchableOpacity
                  onPress={requestPermission}
                  className="bg-cyan-400 py-2.5 rounded-xl items-center"
                >
                  <Text className="text-slate-950 text-[11px] font-black uppercase tracking-wider">
                    Kamera erlauben
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2">
              Barcode-Nummer
            </Text>
            <View className="bg-white/5 border border-white/10 rounded-2xl flex-row items-center px-4 py-3 mb-3">
              <Ionicons name="barcode-outline" size={18} color="rgba(255,255,255,0.4)" />
              <TextInput
                placeholder="8 oder 13 Ziffern"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={manualCode}
                onChangeText={(t) => {
                  setManualCode(t.replace(/\D/g, ""));
                  setError(null);
                }}
                keyboardType="number-pad"
                maxLength={13}
                editable={!busy}
                className="flex-1 text-white font-bold text-sm ml-3"
              />
            </View>

            {error && (
              <View className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 mb-3 flex-row items-center">
                <Ionicons name="alert-circle" size={16} color="#f43f5e" />
                <Text className="text-rose-400 text-[11px] font-semibold flex-1 ml-2">{error}</Text>
              </View>
            )}

            <TouchableOpacity
              onPress={() => submit(manualCode)}
              disabled={!manualCode || busy}
              className="w-full bg-cyan-400 py-3.5 rounded-2xl items-center active:scale-95 disabled:opacity-40"
            >
              {busy ? (
                <ActivityIndicator color="#020617" />
              ) : (
                <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">
                  Getränk suchen
                </Text>
              )}
            </TouchableOpacity>

            {cameraSupported && manualMode && (
              <TouchableOpacity onPress={() => setManualMode(false)} className="mt-4 py-3 items-center">
                <Text className="text-slate-400 text-[11px] font-black uppercase tracking-wider">
                  Zurück zur Kamera
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}
