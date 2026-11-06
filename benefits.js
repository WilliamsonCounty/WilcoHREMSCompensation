// Annual 2026 benefit amounts. Update these together when plan costs change.
const medicalPlans = {
  "hsa": {
    "coverSelf": {
      "premium": 0,
      "contribution": 11635.44
    },
    "coverSpouse": {
      "premium": 1416.96,
      "contribution": 24762.12
    },
    "coverDependents": {
      "premium": 742.56,
      "contribution": 22527.72
    },
    "coverFamily": {
      "premium": 1513.2,
      "contribution": 36301.32
    }
  },
  "choice": {
    "coverSelf": {
      "premium": 708.96,
      "contribution": 8979.96
    },
    "coverSpouse": {
      "premium": 2833.92,
      "contribution": 18966.24
    },
    "coverDependents": {
      "premium": 1485.24,
      "contribution": 17892.72
    },
    "coverFamily": {
      "premium": 3026.4,
      "contribution": 28462.8
    }
  },
  "choicePlus": {
    "coverSelf": {
      "premium": 2766,
      "contribution": 6952.8
    },
    "coverSpouse": {
      "premium": 4591.92,
      "contribution": 17275.32
    },
    "coverDependents": {
      "premium": 3529.08,
      "contribution": 15908.28
    },
    "coverFamily": {
      "premium": 5400.48,
      "contribution": 26185.32
    }
  }
};

const money = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'});
const salaryInputs = {
  hourly: document.getElementById('hourlyInput'),
  biweekly: document.getElementById('biweeklyInput'),
  annual: document.getElementById('yearlyInput'),
};
const coverageInput = document.getElementById('medicalCoverage');
const planInput = document.getElementById('medicalPlan');
const coveredInput = document.getElementById('medicalCovered');
const resultIds = ['vacationTotal', 'sickTotal', 'floatingHolidayTotal',
  'holidayTotal', 'retirementTotal', 'premiumTotal', 'contributionTotal', 'totalCompensation'];
let lastInputSource = 'hourly';
let pieChart;

function readSalary() {
  const input = salaryInputs[lastInputSource];
  if (input.value.trim() === '' || input.validity.badInput) return null;
  const value = Number(input.value);
  const annual = value * {hourly: 2080, biweekly: 26, annual: 1}[lastInputSource];
  // Leave enough headroom for benefit totals as well as salary conversions.
  if (!Number.isFinite(annual * 2) || value < 0) return null;
  return {hourly: annual / 2080, biweekly: annual / 26, annual};
}

function calculate(source) {
  lastInputSource = source;
  const input = salaryInputs[source];
  const hasInput = input.value !== '' || input.validity.badInput;
  const salary = readSalary();
  for (const [key, field] of Object.entries(salaryInputs)) {
    field.disabled = hasInput && key !== source;
    if (key !== source) field.value = salary ? salary[key].toFixed(2) : '';
  }
  updateFormState();
  return salary;
}

function validateInputs() {
  if (!readSalary()) return {field: salaryInputs[lastInputSource], message: 'Enter a salary of zero or more in one of the salary fields.'};
  if (!['Yes', 'No'].includes(coverageInput.value)) return {field: coverageInput, message: 'Select whether you want medical coverage.'};
  if (coverageInput.value === 'Yes') {
    if (!medicalPlans[planInput.value]) return {field: planInput, message: 'Select a medical plan.'};
    if (!medicalPlans[planInput.value][coveredInput.value]) return {field: coveredInput, message: 'Select who will be covered.'};
  }
  return null;
}

function updateFormState() {
  const wantsCoverage = coverageInput.value === 'Yes';
  planInput.disabled = coveredInput.disabled = !wantsCoverage;
  planInput.required = coveredInput.required = wantsCoverage;
  const error = validateInputs();
  document.getElementById('calculateButton').disabled = Boolean(error);
  // Some editor previews retain older HTML while refreshing this script.
  // Create the status element when needed so validation cannot abort startup.
  let message = document.getElementById('validationMessage');
  if (!message) {
    message = document.createElement('p');
    message.id = 'validationMessage';
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    document.getElementById('calculateButton').insertAdjacentElement('afterend', message);
  }
  message.textContent = error ? error.message : '';
  // Clear estimates after an edit so every displayed value describes the same inputs.
  for (const id of resultIds) document.getElementById(id).textContent = '—';
  // Keep the equal-slice preview visible until Calculate supplies actual values.
  drawChart(1, 1, 1, 1);
}

function setValues() {
  const error = validateInputs();
  if (error) {
    updateFormState();
    error.field.focus();
    return null;
  }
  const {hourly, annual: pay} = readSalary();
  const vacation = hourly * 80;
  const sick = hourly * 104;
  const floatingHoliday = hourly * 16;
  const holiday = hourly * 112;
  const retirementContribution = pay * 0.07 * 2.5;
  const pto = vacation + sick + floatingHoliday + holiday;
  const medical = coverageInput.value === 'Yes'
    ? medicalPlans[planInput.value][coveredInput.value]
    : {premium: 0, contribution: 0};
  const values = {
    vacationTotal: vacation, sickTotal: sick, floatingHolidayTotal: floatingHoliday,
    holidayTotal: holiday, retirementTotal: retirementContribution,
    premiumTotal: medical.premium, contributionTotal: medical.contribution,
    totalCompensation: pay + retirementContribution + medical.contribution,
  };
  for (const [id, value] of Object.entries(values)) {
    document.getElementById(id).textContent = money.format(value);
  }
  drawChart(pay - pto, pto, retirementContribution, medical.contribution);
  return values;
}

function drawChart(salary, pto, retirementContribution, contributionTotal) {
  // Calculations remain usable if a chart dependency cannot load.
  if (typeof Chart === 'undefined') return;
  const data = [salary, pto, retirementContribution, contributionTotal];
  if (pieChart) {
    pieChart.data.datasets[0].data = data;
    pieChart.update();
    return;
  }
  const ctx = document.getElementById('compensationChart').getContext('2d');
  pieChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Salary', 'PTO', 'Retirement', 'Benefits'],
      datasets: [{
        data,
        backgroundColor: ['#8CB7CF',
          typeof pattern === 'undefined' ? '#A6CBDD' : pattern.draw('diagonal', '#8CB7CF'),
          '#709445', '#DDDBD5'],
        borderWidth: 1,
      }],
    },
    options: {
      plugins: {
        legend: {position: 'bottom'},
        tooltip: {
          callbacks: {
            label: context => {
              const total = context.dataset.data.reduce((sum, value) => sum + value, 0);
              const percentage = total ? (context.parsed / total * 100).toFixed(1) : '0.0';
              return [money.format(context.parsed), percentage + '%'];
            },
          },
        },
      },
    },
  });
}

for (const [source, input] of Object.entries(salaryInputs)) {
  // Replace the original inline handlers when older markup is being previewed.
  input.removeAttribute('oninput');
  input.removeAttribute('required');
  input.setAttribute('step', 'any');
  input.setAttribute('aria-describedby', 'validationMessage');
  input.addEventListener('input', () => calculate(source));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      calculate(source);
      if (readSalary()) coverageInput.focus();
    }
  });
}
for (const input of [coverageInput, planInput, coveredInput]) {
  input.addEventListener('change', updateFormState);
}
const calculateButton = document.getElementById('calculateButton');
calculateButton.removeAttribute('onclick');
calculateButton.setAttribute('type', 'button');
calculateButton.setAttribute('aria-describedby', 'validationMessage');
calculateButton.addEventListener('click', setValues);
// Synchronize values restored by the browser as well as a fresh page.
lastInputSource = Object.keys(salaryInputs).find(key => salaryInputs[key].value !== '') || 'hourly';
calculate(lastInputSource);
