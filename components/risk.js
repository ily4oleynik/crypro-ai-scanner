function getRiskColor(score){

  if(score >= 76){

    return "green";

  }

  if(score >= 50){

    return "orange";

  }

  return "red";

}