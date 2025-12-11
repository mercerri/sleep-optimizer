const form = document.getElementById("sleep-form");
const useLocationBtn = document.getElementById("use-location");

const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const resultsEl = document.getElementById("results");

const bedtimeWindowEl = document.getElementById("bedtime-window");
const sleepWindowTextEl = document.getElementById("sleep-window");
const sunriseEl = document.getElementById("sunrise");
const sleepDurationEl = document.getElementById("sleep-duration");
const avgTempEl = document.getElementById("avg-temp");
const avgHumidityEl = document.getElementById("avg-humidity");
const comfortNoteEl = document.getElementById("comfort-note");

// --- Utilities ----------------------------------------------------

function showLoading(show) {
  loadingEl.classList.toggle("hidden", !show);
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
  resultsEl.classList.add("hidden");
}

function clearError() {
  errorEl.textContent = "";
  errorEl.classList.add("hidden");
}

/**
 * Force 12-hour time with visible AM/PM.
 */
function formatTime(date) {
  return date
    .toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(" ", "\u00A0"); // keep AM/PM attached
}

function formatTemp(value) {
  return `${value.toFixed(1)} °C`;
}

function formatHumidity(value) {
  return `${value.toFixed(0)} %`;
}

// --- Geolocation helper -------------------------------------------

useLocationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showError("Geolocation is not supported in this browser.");
    return;
  }

  clearError();
  useLocationBtn.disabled = true;
  useLocationBtn.textContent = "Getting location…";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      document.getElementById("latitude").value = latitude.toFixed(4);
      document.getElementById("longitude").value = longitude.toFixed(4);
      useLocationBtn.textContent = "Use my current location";
      useLocationBtn.disabled = false;
    },
    (err) => {
      console.error(err);
      showError("Could not get your location. You can enter it manually.");
      useLocationBtn.textContent = "Use my current location";
      useLocationBtn.disabled = false;
    }
  );
});

// --- API calls ----------------------------------------------------

async function fetchSunriseSunset(lat, lon, dateStr) {
  const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=${dateStr}&formatted=0`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Sunrise–Sunset API error");
  const data = await res.json();
  if (data.status !== "OK") throw new Error("Sunrise–Sunset response error");
  return new Date(data.results.sunrise);
}

async function fetchWeather(lat, lon, startDate, endDate) {
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,relativehumidity_2m&timezone=auto` +
    `&start_date=${startStr}&end_date=${endStr}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Open-Meteo API error");
  const data = await res.json();
  return data.hourly;
}

function computeNightAverages(hourly, start, end) {
  const times = hourly.time.map((t) => new Date(t));
  const temps = hourly.temperature_2m;
  const hums = hourly.relativehumidity_2m;

  let tempSum = 0;
  let humSum = 0;
  let count = 0;
  let maxTemp = -Infinity;
  let maxHum = -Infinity;

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (t >= start && t <= end) {
      const temp = temps[i];
      const hum = hums[i];
      tempSum += temp;
      humSum += hum;
      maxTemp = Math.max(maxTemp, temp);
      maxHum = Math.max(maxHum, hum);
      count++;
    }
  }

  if (count === 0) {
    return null;
  }

  return {
    avgTemp: tempSum / count,
    avgHumidity: humSum / count,
    maxTemp,
    maxHum,
  };
}

// --- Form handling ------------------------------------------------

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  clearError();
  resultsEl.classList.add("hidden");
  showLoading(true);

  try {
    const lat = parseFloat(document.getElementById("latitude").value);
    const lon = parseFloat(document.getElementById("longitude").value);
    const wakeTimeStr = document.getElementById("wake-time").value;
    const sleepHours = parseFloat(document.getElementById("sleep-hours").value);

    if (Number.isNaN(lat) || Number.isNaN(lon) || !wakeTimeStr || !sleepHours) {
      throw new Error(
        "Please fill in latitude, longitude, wake-up time, and sleep hours."
      );
    }

    const now = new Date();
    const [wakeHour, wakeMinute] = wakeTimeStr.split(":").map(Number);

    // Wake-up time is tomorrow at chosen time
    const wakeDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      wakeHour,
      wakeMinute
    );

    const sleepMillis = sleepHours * 60 * 60 * 1000;
    const bedtimeDate = new Date(wakeDate.getTime() - sleepMillis);

    const tomorrowStr = wakeDate.toISOString().slice(0, 10);

    const [sunriseTime, hourlyWeather] = await Promise.all([
      fetchSunriseSunset(lat, lon, tomorrowStr),
      fetchWeather(lat, lon, bedtimeDate, wakeDate),
    ]);

    const stats = computeNightAverages(hourlyWeather, bedtimeDate, wakeDate);

    if (!stats) {
      throw new Error("Could not find weather data for the selected window.");
    }

    // --- Bedtime & sleep windows ---

    const bedtimeBufferMinutes = 30;
    const bedtimeStart = new Date(
      bedtimeDate.getTime() - bedtimeBufferMinutes * 60 * 1000
    );

    bedtimeWindowEl.textContent = `Go to bed between ${formatTime(
      bedtimeStart
    )} and ${formatTime(bedtimeDate)}.`;

    if (sleepWindowTextEl) {
      sleepWindowTextEl.textContent = `You’ll likely be asleep between ${formatTime(
        bedtimeDate
      )} and ${formatTime(wakeDate)}.`;
    }

    sunriseEl.textContent = formatTime(sunriseTime);
    sleepDurationEl.textContent = `${sleepHours.toFixed(1)} hours`;

    avgTempEl.textContent = formatTemp(stats.avgTemp);
    avgHumidityEl.textContent = formatHumidity(stats.avgHumidity);

    let comfort = "Conditions look reasonable for sleep.";
    if (stats.avgTemp > 24 || stats.maxTemp > 26) {
      comfort = "It may feel warm overnight. A fan or lighter bedding might help.";
    }
    if (stats.avgHumidity > 70 || stats.maxHum > 80) {
      comfort +=
        " Humidity is also fairly high, which can make sleep feel sticky.";
    }

    comfortNoteEl.textContent = comfort;

    showLoading(false);
    resultsEl.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    showLoading(false);
    showError(err.message || "Something went wrong. Please try again.");
  }
});
