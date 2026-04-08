function mergeDailyUsage(...sources) {
  const dayMap = {};
  for (const source of sources) {
    for (const day of source) {
      dayMap[day.date] = dayMap[day.date] || { date: day.date, modelBreakdowns: [] };
      dayMap[day.date].modelBreakdowns.push(...day.modelBreakdowns);
    }
  }
  return Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { mergeDailyUsage };
