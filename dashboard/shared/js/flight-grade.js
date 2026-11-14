export function flightGrade(score) {
  if (!Number.isFinite(score)) return null;
  if (score >= 95) return 'S';
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 55) return 'C';
  return score > 40 ? 'D' : 'F';
}

export function scoreText(score) {
  return Number.isFinite(score) ? String(Number(score.toFixed(1))) : '—';
}

export function passText(score) {
  return score >= 70 ? 'Passed' : 'Below pass mark';
}

export function gradeLabel(score) {
  const element = document.createElement('strong');
  const grade = flightGrade(score);
  element.className = 'flight-grade';
  if (grade) {
    element.dataset.grade = grade;
    element.setAttribute('aria-label', 'Grade ' + grade);
  }
  element.textContent = grade || '—';
  return element;
}
