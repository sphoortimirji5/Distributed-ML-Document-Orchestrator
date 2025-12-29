output "vpc_id" {
  value = aws_vpc.main.id
}

output "pdf_bucket_name" {
  value = aws_s3_bucket.pdfs.id
}

output "results_bucket_name" {
  value = aws_s3_bucket.results.id
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.main.name
}

output "kinesis_stream_name" {
  value = aws_kinesis_stream.main.name
}

output "ssm_parameter_path" {
  value = "/${var.project_name}/${var.environment}/"
}
