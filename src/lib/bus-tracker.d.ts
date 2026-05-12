export type FleetRow = {
  vehicleId: string;
  busId: string | null;
  destination: string | null;
  seconds: number | null;
  distanceFeet: number | null;
  predictionTime: string | null;
  isDelayed: boolean;
  countdownLabel: string | null;
  nextStopName: string | null;
};
